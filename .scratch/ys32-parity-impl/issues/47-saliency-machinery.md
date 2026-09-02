# 47: Saliency machinery on the VM

**What to build:** node-group content selection works identically to upstream — complexity scoring (`always`=0, `once`+1, expression = boolean-operator count +1), all four strategies with Random BLRV default and a pluggable two-method strategy interface, `<<set_saliency>>`, line groups `=>`, node-group conformance errors (member without `when:`, YS0032 duplicate subtitle), and the query APIs (`isNodeGroup`, saliency options, `hasSalientContent`) — observable in the event stream via the fixture `saliency:` steps; saliency history as generated variables in storage.

**Blocked by:** 46 (VM completion).

**Status:** done

- [x] Saliency steps in the testplan corpus green — LineGroups, NodeGroups, NodeGroupsContentQuerying, and Once pairs run through the harness (allowlist entries removed; only FormatFunctions remains, ticket 48).
- [x] Strategy switching observable in the event stream — upstream Try-Yarn-Spinner command `<<set_saliency first|random|best|best_least_recent|random_best_least_recent>>` (internal, never a `command` event) plus `Dialogue.setSaliencyStrategy(mode)` / `contentSaliencyStrategy` get/set (upstream `Dialogue.ContentSaliencyStrategy` shape); harness `saliency:` steps swap strategies between plan runs.
- [x] Node-group conformance errors assert exact YS codes — YS0031 (member without `when:`) and YS0032 (duplicate `subtitle:`) asserted in `saliency.test.ts` and the diagnostics suite.
- [x] Full suite green — 274/274 (`npm test`).

## Implementation map

- `src/runtime/saliency.ts` — `ContentSaliencyOption`, `SaliencyState`, `ContentSaliencyStrategy` (`queryBestContent`/`contentWasSelected`), the four built-ins, mode registry (both upstream vocabularies), complexity scoring (`booleanOperatorCount` counts `and`/`&&`, `or`/`||`, `xor`/`^`, strings excluded — upstream `GetBooleanOperatorCountInExpression` counts `ExpAndOrXor` nodes), condition parsing, `nodeGroupMemberId` (`Title.Subtitle` / `Title.<index>`; upstream derives CRC32 names — our program format lacks file/line, noted in-file).
- `src/compile/*` — `LINE_GROUP` token (`=>`), `LineGroup` AST statement, `lowerLineGroup` mirroring upstream NodeGroupCompiler's line-group lowering (`addSaliencyCandidate`/`selectSaliencyCandidate`/`popJump`, once-flag store at body start); undeclared variables used as bare bool conditions get implicit `initialValues` declarations (narrow slice — only Once.testplan needs it).
- `src/runtime/vm.ts` — node-group entry selection through the strategy (no salient content → silent completion, upstream hub Return); view counts as generated variables `Yarn.Internal.Content.ViewCount.<contentID>` in storage; query APIs + `has_any_content()` builtin.
- Tests: `src/tests/saliency.test.ts` (23 tests, traced step-by-step against the fixtures' expected BLRV selections).
- Docs updated: `docs/saliency.md`, `docs/line-groups.md`, `docs/node-groups.md`, `docs/commands.md` (were inaccurate pre-feature transcriptions); ADR 0003 records the member-ID divergence (program format has no file/line, so no CRC32 names).

## Known follow-ups
- Malformed `when:` expressions fail at runtime (codegen-fallback convention: uncompilable condition → false) where upstream rejects them at compile time with a diagnostic — candidate for a compile-time `when:`-expression check.
- `nodeGroupMemberId` index-based fallback means reordering members shifts saliency-history keys (view counts / once-state) — recorded in ADR 0003; revisit if the program format ever carries source positions.
