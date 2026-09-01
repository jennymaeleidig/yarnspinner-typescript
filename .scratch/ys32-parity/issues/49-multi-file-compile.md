# 49: Multi-file compile + external declarations + four modes

**What to build:** hosts compile collections of files — `compile(files)` with `{name, source}` entries, no globs or filesystem I/O in the library — with an external declarations API (variables/functions/enums; conflicts produce YS diagnostics), all four compilation modes (full, strings-only, declarations-only, type-check-only which also emits the string table), a compile-time Library for signature checking, and the upstream camelCased result shape. Exercised by the upstream `Projects/Basic` and `Space` projects (`.ysls` included) and the vendored `Duplicates/` fixtures.

**Blocked by:** 41 (host-defined enums feed the declarations path), 46 (program format settled).

**Status:** ready-for-agent

- [ ] Upstream multi-file projects compile and their plans run
- [ ] All four modes observable at the compile seam
- [ ] Declaration conflicts produce YS diagnostics
- [ ] Full suite green
