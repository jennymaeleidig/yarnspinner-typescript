## Saliency (Yarn Spinner)

Source: [docs.yarnspinner.dev — Saliency](https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/saliency) · API: [Yarn.Saliency namespace](https://docs.yarnspinner.dev/api/csharp/yarn.saliency)

**Saliency** decides how [line groups](line-groups.md) and
[node groups](node-groups.md) pick which content to run. The deciding method
is the **saliency strategy**. Strategies receive, per item: how many of its
conditions passed, how many failed, its complexity score, and a unique
content key.

### Complexity scoring

- `when: always` scores 0.
- Otherwise, add together:
  - 1 for a `once` marker;
  - for an expression, its binary boolean operator count (`and`/`&&`,
    `or`/`||`, `xor`/`^`) plus 1.

Examples (upstream docs): `when: always` → 0; `when: $a` → 1; `when: $a or
$b` → 2; `when: once` → 1; `when: once if $a or $b` → 3.

### Built-in strategies

- **First**: the first item that has not failed any condition.
- **Best**: the highest-complexity non-failing item (first of ties).
- **Best Least Recently Viewed**: non-failing items sorted by how many
  times each was selected, then by score; the first of the best remaining.
- **Random Best Least Recently Viewed**: as above, but a random one of the
  best remaining. **This is the default** when no strategy is set.

The default in this runtime matches upstream: Random Best Least Recently
Viewed.

### Changing the strategy

Upstream's Try Yarn Spinner accepts `<<set_saliency first|random|best|
best_least_recent|random_best_least_recent>>`; this runtime implements that
command, and the runtime API carries the upstream property shape
(`contentSaliencyStrategy` get/set, mirroring
`Dialogue.ContentSaliencyStrategy`) plus a mode switcher
(`setSaliencyStrategy(mode)`). A host may also provide a strategy at
construction (`DialogueOptions.contentSaliencyStrategy`).

Custom strategies implement the two-method interface
(upstream `IContentSaliencyStrategy`):

- `queryBestContent(content)` — read-only choice; returns the best option
  or `null` when none should run;
- `contentWasSelected(content)` — commits a selection; strategies that
  track view counts update their state here.

### Querying content availability

- `isNodeGroup(nodeName)` — whether a name is a node group.
- `getSaliencyOptionsForNodeGroup(nodeGroup)` — each member's pass/fail
  counts and complexity, read-only (a plain node queries as a single
  passing option).
- `hasSalientContent(nodeGroup)` — whether the strategy could select
  anything; also exposed as the `has_any_content()` function in scripts.

### Implementation notes (this runtime)

- View counts (saliency history) are generated variables in variable
  storage, keyed `Yarn.Internal.Content.ViewCount.<contentID>` (upstream
  `$Yarn.Internal.Content.ViewCount.<contentID>`) — they reset with the
  store (coding standards §4). `when: once` seen-state keys are
  `Yarn.Internal.Once.<contentID>` (upstream `$Yarn.Internal.Once.<id>`,
  minus the `$` sigil — the storage layer normalizes it away on every
  variable).
- Saliency-condition expressions compile to bytecode (the compiler's
  expression codegen) and run on the VM's stack; the string evaluator is
  the fallback for uncompilable expressions.
