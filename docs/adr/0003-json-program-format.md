# Versioned JSON program format

Compiled programs need to be serializable (precompile in Node, run in the browser) and stable across versions. Upstream uses a protobuf binary `Program`; adopting it was rejected because artifact compatibility with Unity-compiled programs is out of scope for this project. We decided the program format is this project's own documented, versioned JSON with a `languageVersion` field (mirroring the purpose of upstream's 3.1 addition), so programs are inspectable, diffable, and version-checked without protobuf tooling.

## Consequences

The format's schema is part of the public contract once 0.2.0 ships; changes require a version bump and a migration note.

Because instructions carry no file/line info (a deliberate drop from upstream), anything upstream derives from source position cannot be reproduced exactly: node-group member IDs use `Title.Subtitle` / `Title.<index>` (ticket 47) where upstream derives CRC32-of-source-position names, so reordering a group's members shifts their saliency-history keys (view counts, once-state).
