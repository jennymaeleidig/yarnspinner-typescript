# Visit tracking & the `tracking:` header

Type: grilling
Status: resolved
Blocked by: 05

## Question

The maintainer confirmed `tracking: always|never` is a wanted feature (deferred from [Statement/line parity phasing](./04-statement-parity-phasing.md) only until the runtime shape is settled). Decide its full semantics for the TS runtime: how visit tracking works today (audit: `visited()`/`visited_count()` exist; VM tracks on node return upstream — census §4), what `always` (force tracking even if never queried) and `never` (suppress) mean concretely, whether the fork's IR needs changes to support it (this hinges on the IR/VM fog patch), how it interacts with `once`-state-as-generated-variables (upstream stores `once`/content-viewed state as variables in VariableStorage, 3.2.1), and what the runtime API exposes for it (upstream: nothing dedicated — tracking is a codegen/VM concern; visit state lives in VariableStorage and resets with it).

## Answer

All recommendations confirmed by the maintainer:

1. **Visit state as generated variables in VariableStorage** (`$visited_<node>` style) — consistent with once-state (ticket 05) and saliency history (ticket 06); clearing the store resets visits.
2. **Visits recorded on node return** (upstream conform; `visited()` during a node reports the pre-visit count).
3. **`tracking: never` = suppress recording for that node; `tracking: always` = accepted, equivalent to default** (documented as such; gains meaning only if selective tracking ever lands).
4. **Node-group aggregation conforms** (3.1 fix): visiting any salient member counts under the group's shared title.
5. **IR representation deferred to ticket 14** — this ticket fixes semantics only.
