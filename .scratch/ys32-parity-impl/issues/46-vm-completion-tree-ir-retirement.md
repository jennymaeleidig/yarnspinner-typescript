# 46: VM completion — tree IR retires

**What to build:** everything the fork's runner does today works on the VM — once-state and visit counts as generated variables in storage, detour/`<<return>>` as a call stack of return addresses (jump inside detour clears it), `tracking:` header, command expansion and value rendering — so the full suite and all 32 testplan pairs run on the VM alone and the tree IR is deleted (contract step).

**Blocked by:** 45 (VM core).

**Status:** ready-for-agent

- [ ] All 32 testplan pairs green on the VM
- [ ] Full suite green with tree IR deleted
- [ ] No duplicated behavior between old and new execution paths
