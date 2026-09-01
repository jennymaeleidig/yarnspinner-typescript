# 47: Saliency machinery on the VM

**What to build:** node-group content selection works identically to upstream — complexity scoring (`always`=0, `once`+1, expression = boolean-operator count +1), all four strategies with Random BLRV default and a pluggable two-method strategy interface, `<<set_saliency>>`, line groups `=>`, node-group conformance errors (member without `when:`, YS0032 duplicate subtitle), and the query APIs (`isNodeGroup`, saliency options, `hasSalientContent`) — observable in the event stream via the fixture `saliency:` steps; saliency history as generated variables in storage.

**Blocked by:** 46 (VM completion).

**Status:** ready-for-agent

- [ ] Saliency steps in the testplan corpus green
- [ ] Strategy switching observable in the event stream
- [ ] Node-group conformance errors assert exact YS codes
- [ ] Full suite green
