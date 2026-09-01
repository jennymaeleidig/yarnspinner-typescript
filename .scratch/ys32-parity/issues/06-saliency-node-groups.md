# Saliency & node groups scope

Type: grilling
Status: resolved
Blocked by: —

## Question

The fork's `when:` node groups pick first-match-wins; upstream (census §2, §4) has complexity scoring, four strategies (First, Best, Best-Least-Recently-Viewed, Random BLRV — **default**), a pluggable `IContentSaliencyStrategy`, `has_any_content()`, `GetSaliencyOptionsForNodeGroup`/`HasSalientContent`, `<<set_saliency>>` command, compile error on a group member lacking `when:`, and saliency applying to **line groups `=>`** too. Decide: full machinery vs subset for the first spec; default strategy; whether the strategy is pluggable from TS day one; how line-group saliency and the (deferred-or-not) `=>` syntax interact ([04](./04-statement-parity-phasing.md)); and what the demo needs to show this.

## Answer

All recommendations confirmed by the maintainer:

1. **Full machinery**: complexity scoring (`always`=0, `once`+1, expression = boolean-operator count +1) and all four strategies — First, Best, Best-Least-Recently-Viewed, **Random BLRV as default**. Forced by the fixture corpus (`saliency:` testplan steps).
2. **Pluggable strategy day one**: two-method TS interface mirroring `IContentSaliencyStrategy` (`queryBestContent` / `contentWasSelected`).
3. **`<<set_saliency>>` command included**; per ticket 04's delegation, **line groups `=>` are in the first spec**.
4. **Node-group conformance errors included** (member lacking `when:`, duplicate `subtitle` via YS0032 — land through the diagnostics contract, ticket 10); runtime queries included: `has_any_content()` built-in, `isNodeGroup`, `getSaliencyOptionsForNodeGroup`, `hasSalientContent`.
5. **Saliency history (view recency, weights) stored as generated variables in VariableStorage** — resettable with the store, consistent with the once-state mechanism.

Demo: the browser demo exercises node-group selection visibly (a storylet-style example exercising `when:` + strategy switching via `<<set_saliency>>`).
