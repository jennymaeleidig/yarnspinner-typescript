# 41: Enums end-to-end

**What to build:** a 3.2 script using enums compiles and runs identically to upstream — uniform raw values, auto-numbering, `.Case` shorthand, same-enum `==`/`!=` restriction enforced at compile time — and hosts can register their own enum types from TypeScript, which flow through the external declarations path into compile-time checking and `userDefinedTypes` in the compile result.

**Blocked by:** 23 (diagnostics channel).

**Status:** ready-for-agent

- [ ] Upstream enum fixtures compile and their plans run
- [ ] Host-defined enums accepted and checked at compile time
- [ ] Enum metadata appears in compile-output declarations
- [ ] Full suite green
