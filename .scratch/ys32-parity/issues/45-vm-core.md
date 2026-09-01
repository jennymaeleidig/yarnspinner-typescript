# 45: VM core

**What to build:** a stack VM executes the instruction-stream program end-to-end for linear flow — Line/Options/Command/NodeStart/NodeComplete events, linear execution, jumps — and a first tranche of testplan pairs runs green against it, behind the same public runtime API.

**Blocked by:** 44 (program format).

**Status:** ready-for-agent

- [ ] First tranche of testplan pairs green on the VM
- [ ] Tree-IR runtime still green for the remainder (both drivers coexist)
- [ ] Full suite green
