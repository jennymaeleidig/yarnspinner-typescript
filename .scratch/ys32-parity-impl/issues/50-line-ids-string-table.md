# 50: Line IDs + string table

**What to build:** the compile output carries the upstream string-table contract — implicit line IDs via CRC32(file+node+count) replacing the fork's global counter, explicit `#line:` verbatim, `#shadow:` compile-time validation (YS0042/43/44), shadow lines in the table, hashtag metadata attached — observable at the compile seam.

**Blocked by:** 49 (multi-file model defines file+node identity).

**Status:** ready-for-agent

- [ ] String table matches upstream shape for the fixture corpus
- [ ] Implicit IDs CRC32-based; `#shadow:` validation asserts YS0042/43/44
- [ ] Full suite green
