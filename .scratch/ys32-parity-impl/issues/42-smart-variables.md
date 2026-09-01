# 42: Smart variables end-to-end

**What to build:** a 3.2 script using smart variables compiles and runs identically to upstream — read-only (YS0030), recompute-on-access, cycle detection (YS0045), `tryGetSmartVariable` — with the regex heuristic and set-downgrades-smart behaviors gone.

**Blocked by:** 23 (diagnostics channel).

**Status:** ready-for-agent

- [ ] Upstream smart-variable fixtures compile and their plans run
- [ ] Read-only, recompute, and cycle diagnostics assert exact YS codes
- [ ] Full suite green
