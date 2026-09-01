# Smart variables & enums semantics

Type: grilling
Status: resolved
Blocked by: —

## Question

Both features exist in the fork only as partials (audit: smart variables via a regex heuristic, `set` downgrades smart→regular; enums store case *names* only). Upstream (census §2): smart variables are `<<declare $x = expr>>` with a full expression, recomputed on every access, **read-only** (YS0030), cycle-detected (YS0045), with a runtime `TryGetSmartVariable`; enums carry uniform raw values (numeric or string, auto-numbered), compare only `==`/`!=` within the same enum, use `.Case` shorthand, and can type declarations and function params. Decide: adopt full upstream semantics for both (recommended), or stage; what `<<declare ... as Type>>` means in a dynamically-typed TS runtime (types as validation? as declarations metadata?); and how enums surface in the TS API.

## Answer

All recommendations confirmed by the maintainer:

1. **Smart variables: full upstream semantics** — read-only (YS0030 diagnostic), recomputed on every access, self/cycle detection (YS0045), `tryGetSmartVariable(name)` runtime accessor. The regex heuristic and set-downgrades-smart behavior are removed.
2. **`as Type` = compile-time validation + declarations metadata**; runtime stays naturally JS-typed (number/bool/string); no runtime coercion layer.
3. **Enums: full adoption** — uniform raw values (numeric or string, auto-numbered when omitted), `==`/`!=` restricted to same-enum comparisons (compile-time diagnostic), `.Case` shorthand.
4. **Host-defined enums (EnumTypeBuilder equivalent): deferred** — Library registry (ticket 05) is the natural later home; `.yarn`-declared enums cover conformance.
5. **Runtime representation: plain raw values**; enum identity enforced at compile time; `.Case` resolves to the raw value at compile time.

**Amendment (post-map, maintainer request)**: host-defined enums (the EnumTypeBuilder equivalent) are **promoted into scope** — hosts register enum types from TypeScript via the external declarations API (ticket 15's path, mirroring how upstream's `EnumTypeBuilder` output feeds `CompilationJob.Declarations`). Earlier deferral reversed.
