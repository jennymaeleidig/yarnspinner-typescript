# 42: Smart variables end-to-end

**What to build:** a 3.2 script using smart variables compiles and runs identically to upstream — read-only (YS0030), recompute-on-access, cycle detection (YS0045), `tryGetSmartVariable` — with the regex heuristic and set-downgrades-smart behaviors gone.

**Blocked by:** 23 (diagnostics channel).

**Status:** resolved

## Landing notes

Implemented against the upstream 3.2.2 source (TypeCheckerListener.ResolveInitialValues, Compiler.AddErrorsForSettingReadonlyVariables, GetDependenciesForVariable, SmartVariableEvaluationVirtualMachine), not just the docs page:

- **Classification** (`src/compile/smartVariables.ts`, new): a `<<declare>>` initializer that is not a plain literal shape — number with at most one unary minus (issue #421), string, `true`/`false`, or enum member reference (`Enum.Case`/`.Case`) — declares a smart variable. Includes the registry-example quirk that a parenthesized literal `(1)` IS a smart variable. The runtime's old regex-over-operator-chars heuristic is deleted.
- **YS0030** (typeCheck): `<<set>>`/compound assignment to a smart variable → `$x cannot be modified (it's a smart variable and is always equal to …)`, matching the vendored registry template.
- **YS0045** (typeCheck): upstream-faithful depth-tracking DFS over smart declarations; re-reaching a decl at a different depth is a loop, same depth (`$E = $C || $C`) is fine. One diagnostic per starting smart declaration, as upstream. MUST_FAIL allowlist entry self-cleaned.
- **Program surface** (ir/compiler): `program.smartVariables: Record<name, initializer expression>`; smart variables excluded from `initialValues` (upstream: not in `Program.InitialValues`). `VariableDeclaration.isSmartVariable` in the compile result, `defaultValue` undefined for smart.
- **Runtime**: evaluator recomputes on every read; stored value shadows smart (upstream VariableKind.Stored precedence); set-downgrade behavior gone. `YarnRunner.tryGetSmartVariable` (upstream `Dialogue.TryGetSmartVariable`) returns `{ ok, value }`; `getVariable` recomputes smart names.
- New `src/tests/smartVariables.test.ts` (12 tests); docs/smart-variables.md rewritten from the thin host-binding placeholder to the 3.2 contract with upstream citations.
- Full suite green (206 tests).

- [x] Upstream smart-variable fixtures compile and their plans run
- [x] Read-only, recompute, and cycle diagnostics assert exact YS codes
- [x] Full suite green
