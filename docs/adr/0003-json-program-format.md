# Versioned JSON program format

Compiled programs need to be serializable (precompile in Node, run in the browser) and stable across versions. Upstream uses a protobuf binary `Program`; adopting it was rejected because artifact compatibility with Unity-compiled programs is out of scope for this project. We decided the program format is this project's own documented, versioned JSON with a `languageVersion` field (mirroring the purpose of upstream's 3.1 addition), so programs are inspectable, diffable, and version-checked without protobuf tooling.

## Consequences

The format's schema is part of the public contract once 0.2.0 ships; changes require a version bump and a migration note.

Because instructions carry no file/line info (a deliberate drop from upstream), anything upstream derives from source position cannot be reproduced exactly: node-group member IDs use `Title.Subtitle` / `Title.<index>` where upstream derives CRC32-of-source-position names, so reordering a group's members shifts their saliency-history keys (view counts, once-state).

## Amendment: version 2 — header retention, source provenance, upstream unique member names

Supersedes the consequence paragraph above (kept for the record): version 2
of the format (upstream 3.2.2 parity, wave-2/3 fidelity work) removes both
limitations it describes.

- **Per-node header retention:** every compiled node carries its raw
  `headers` (key → value as authored — upstream `Node.Headers`), including
  the `tags:` raw text, plus `sourceFile`/`startLine` provenance (upstream
  `NodeGroupCompiler`'s node-context position). Host-side header queries
  (`Dialogue.GetHeaders`/`GetHeaderValue`) have data; the source position
  the old paragraph called unreproducible now rides the node, not the
  instruction.
- **Node-group members adopt upstream's unique names** (upstream
  `Utility.GetNodeUniqueName`): every `when:`-bearing member is renamed to
  `Title.Subtitle` or `Title.<crc32(fileName + title + startLine)>` and
  registered in `nodes` under it — individually jump-addressable, upstream
  exact. The hub node keeps the source title; jumping to the group name
  selects a member by saliency as before. Member saliency content IDs and
  once-state keys derive from the unique name (upstream's shape), replacing
  the pre-upgrade `Title.<index>` fallback — so reordering a group's
  members no longer shifts their history keys (the failure mode the
  superseded paragraph recorded).
- `languageVersion` bumps to **2** (`programLanguageVersion`,
  `src/compile/program.ts`); version 1 artifacts are not auto-migrated.
  The schema delta is additive-plus-renames described above; programs
  carry `nodes[title].headers` where version 1 nodes were bare
  instruction streams.
- Node-table insertion order mirrors upstream `Compiler.cs`: source-order
  nodes (members under their unique names) first, then the appended hub
  entries — `Dialogue.nodeNames()` matches upstream `NodeNames` order.
