# Statement/line parity phasing

Type: grilling
Status: resolved
Blocked by: —

## Question

The census (see [ys322-census.md](../research/ys322-census.md), §2) lists statement- and line-level features the fork lacks outright. The default is "conform" — the decision here is **what lands in the first spec vs deferred**:

- Line-level conditions: `<<if expr>>`, `<<once>>`, `<<once if expr>>` before a line
- `<<call func(...)>>` statement
- Compound assignment `<<set $x += 1>>` etc.
- `<<return>>` (and detour/jump interaction: jump inside detour clears return stack)
- `<<wait>>` and a *working* `<<stop>>` as built-in commands
- Escapable `:` in character names (3.2.0)
- `tracking: always|never` and `subtitle` headers
- `<<set>>` requiring `$` prefix (fork currently normalizes `$` away)
- Line groups `=>` (whole feature; ties into saliency)

Confirm each as "first spec" or "deferred", flagging any where the fork's existing behavior makes conformance expensive.

## Answer

All recommendations confirmed by the maintainer:

- **First spec**: line-level `<<if>>`/`<<once>>`/`<<once if>>` conditions; `<<call>>`; compound assignment (`+= -= *= /= %=`); `<<return>>` + detour/jump interaction (jump inside detour clears return stack); built-in `<<wait>>` (consumer-timed command) and a working `<<stop>>` (halts, fires DialogueComplete — fixes the current no-op bug); escapable `:` in character names; `subtitle` header (with the YS0032 group-duplicate check); `<<set>>` requiring `$` (bare-var normalization removed, diagnostic for existing content).
- **Deferred → promoted to its own ticket**: `tracking: always|never` — the maintainer confirmed it is absolutely wanted; it became [13-visit-tracking-header.md](./13-visit-tracking-header.md), blocked by the runtime API shape decision.
- **Delegated**: line groups `=>` → decided with [Saliency & node groups scope](./06-saliency-node-groups.md); if full saliency machinery lands, `=>` is automatically in the first spec.

No conformance-cost flags raised; the one intentional break (bare-var normalization) is accepted with a diagnostic.
