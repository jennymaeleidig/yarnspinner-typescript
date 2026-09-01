# Diagnostics catalog (YS0001–YS0047)

Type: research
Status: resolved
Blocked by: —

## Question

Pull the complete YS00xx diagnostics table from docs.yarnspinner.dev (errors page) and the YarnSpinner compiler source: code, severity, message, and trigger condition for every entry YS0001–YS0047. Then assess applicability to this TS compiler: which codes are immediately applicable (e.g. duplicate node title YS0011, type mismatch YS0002), which depend on features this repo doesn't have yet (projectFileVersion YS0036, .yarnproject), and which are C#/ANTLR-specific. Deliver a proposed mapping: adopt-code-as-is / adopt-code-with-adjusted-trigger / N-A. This feeds the diagnostics decision ([10](./10-diagnostics-decision.md)).

## Answer

Full catalog with trigger conditions, source citations, docs-vs-source discrepancy log, and the complete per-code mapping lives in [research/ys322-diagnostics.md](../research/ys322-diagnostics.md). Primary source: `YarnSpinner.Diagnostics/Definitions/YSxxxx-*.md` in YarnSpinnerTool/YarnSpinner @ `ec1a680` (2026-08-11 = 3.2.2) — one markdown file per code carrying code, messageTemplate, defaultSeverity/minimumSeverity, published/deprecated, generated_in; the docs [Errors page](https://docs.yarnspinner.dev/write-yarn-scripts/yarn-spinner-editor/errors.md) is a secondary rendering of that registry and is stale in several places.

### Catalog YS0001–YS0047 (from source; severity = default/minimum)

**Errors (default error):**

| Code | Name | Message template | Trigger | Notes |
|---|---|---|---|---|
| YS0001 | ImplicitVariableTypeConflict | `Variable {0} has been implicitly declared with multiple types: {1}` | Variable implicitly typed two ways | **deprecated v3.2.1, never emitted** |
| YS0002 | TypeMismatch | `Type mismatch: expected {0}, got {1}` | Expression type mismatch | **deprecated v3.2.1 → replaced by YS0050** |
| YS0004 | MissingDelimiter | `Missing node delimiter` | Missing `---` / `===` | |
| YS0005 | SyntaxError | `Syntax error: {0}` | ANTLR parse failure | carries exact line/col |
| YS0006 | UnclosedCommand | `Unclosed command: missing >>` | `<<` never closed | |
| YS0007 | UnclosedScope | `Unclosed scope: expected an <<{0}>> to match the <<{1}>> statement on line {2}` | Missing `<<endif>>`/`<<endonce>>` | cites opening line |
| YS0011 | DuplicateNodeTitle | `Duplicate node title: '{0}'` | Duplicate titles that don't form a valid group | not emitted for valid groups |
| YS0013 | UnknownFunction | `Unknown function {0}` | Function not in Library | languageserver; 3.2.1 |
| YS0014 | WrongFunctionParameters | `Invalid function call: {0}` | Wrong arity/param types | 3.2.1 |
| YS0017 | LinesCantHaveLineAndShadowTag | `Lines cannot have both a '#line' tag and a '#shadow' tag.` | `#line:` + `#shadow:` on one line | |
| YS0018 | DuplicateLineID | `Duplicate line ID '{0}'` | Same `#line:` twice in project | |
| YS0020 | CommandFollowingLine | `Command "{0}" found following a line of dialogue. Commands should start on a new line.` | Text then `<<cmd>>` same line | only `<<if>>` may follow a line |
| YS0027 | InvalidNodeName | `Unexpected '{1}' in node {0}. Titles can only contain letters, numbers, and underscores.` | Bad char in title/subtitle | |
| YS0028 | TypeInferenceFailure | `Can't determine type of {0} given its usage. Manually specify its type with a declare statement.` | Variable type not inferable | |
| YS0029 | ExpressionTypeUndetermined | `Can't determine the type of the expression {0}.` | Expression type unresolvable | |
| YS0030 | SmartVariableReadOnly | `{0} cannot be modified (it's a smart variable and is always equal to {1})` | `<<set>>` on smart variable | |
| YS0031 | NodeGroupMissingWhen | `All nodes in the group '{0}' must have a 'when' clause (use 'when: always' …).` | Group member lacks `when:` | |
| YS0032 | DuplicateSubtitle | `More than one node in group {0} has subtitle {1}.` | Duplicate `subtitle:` in group | |
| YS0035 | EnumDeclarationError | `{0}` | Catch-all enum declaration errors | upstream plans to split |
| YS0036 | LanguageVersionTooLow | `{0}` | Feature needs `projectFileVersion` ≥ 3 | needs `.yarnproject` |
| YS0037 | InvalidLiteralValue | `{0}` | Literal unparseable / wrong type | |
| YS0038 | InvalidMemberAccess | `{0}` | `Type.Member` unresolvable | |
| YS0039 | RedeclarationOfExistingVariable | `Redeclaration of existing variable {0}` | Two `<<declare>>`s | |
| YS0040 | RedeclarationOfExistingType | `Can't create a new type {0}: a type with this name already exists` | Duplicate type/enum name | |
| YS0041 | InternalError | `Internal compiler error: {0}` | Unexpected failure | |
| YS0042 | UnknownLineIDForShadowLine | `Unknown line ID {0} for shadow line` | `#shadow:` → unknown `#line:` | |
| YS0043 | ShadowLinesCantHaveExpressions | `Shadow lines must not have expressions` | `{expr}` in shadow line | |
| YS0044 | ShadowLinesMustHaveSameTextAsSource | `Shadow lines must have the same text as their source` | Text mismatch vs source | |
| YS0045 | SmartVariableLoop | `Smart variables cannot contain reference loops (referencing {0} … {1}).` | Smart-var reference cycle | |
| YS0046 | NullDefaultValue | `Variable declaration {0} (type {1}) has a null default value…` | Null default | **deprecated v3.2.1, unreachable** |
| YS0047 | TypeSolverTimeout | `Expression failed to resolve in a reasonable time ({0})…` | Constraint solver time limit | upstream-solver-specific |

**Warnings/info (default/min):** YS0003 UndefinedVariable (warning/none — undeclared variable) · YS0008 UnreachableCode (warning/none — code after jump/return/stop) · YS0010 UnusedVariable (info/none — declared, never used) · YS0012 UndefinedNode (warning/none — jump/detour to nonexistent node) · YS0015 CyclicDependency (info/none — node jump cycle; languageserver) · YS0016 UnknownCharacter (info/none — character not in project; languageserver) · YS0019 LineContentAfterCommand (warning/none — dialogue after `<<cmd>>`) · YS0021 StrayCommandEnd (warning/none — `>>` without `<<`) · YS0022 UnenclosedCommand (warning/none — command keyword without `<<>>`) · YS0033 EmptyNode (warning/none — node compiles to nothing) · YS0034 InvalidLibraryFunction (error — unusable C# signature; languageserver).

### Mapping

- **Adopt as-is (12, immediately implementable):** YS0004, YS0005, YS0006, YS0007, YS0012, YS0021, YS0027, YS0030, YS0031, YS0033, YS0041, YS0045. YS0030 and YS0031 also close live divergences (repo silently converts smart→regular on `set`; repo never errors on `when:`-less group members).
- **Adopt with adjusted trigger (10):** YS0003 (needs compile-time declarations), YS0011 (only for duplicate titles that don't form a valid group — overlaps YS0031), YS0013/YS0014 (check against the runner's functions map instead of Library reflection), YS0019/YS0020/YS0022 (single-line lexer → define same-line triggers lexically), YS0032 (needs `subtitle:` parsing), YS0035 (needs enum values).
- **Deferred — adopt when feature lands (10):** YS0010, YS0039 (compile-time declarations) · YS0018 (hashtag-value syntax) · YS0037, YS0038, YS0040 (enum raw values / `.Case`) · YS0042, YS0043, YS0044 (shadow lines).
- **N-A (14):** YS0001, YS0002, YS0046 (deprecated upstream — emit **YS0050** for type errors, not YS0002) · YS0009, YS0015, YS0016 (languageserver-only; YS0016 also needs a project character list) · YS0023–YS0026 (**do not exist in the 3.2.2 source registry** — docs-page anomaly; reserve, don't emit) · YS0034 (C#-reflection-specific) · YS0036 (needs `.yarnproject`/projectFileVersion model) · YS0047 (tied to upstream's constraint type-solver).

### Key findings for ticket 10

1. The registry is **bigger than YS0047**: YS0048, YS0050–YS0053, YS0060–YS0064 exist in 3.2.2 (YS0050 = live type-error catch-all; YS0063 = markup diagnostics folded into compilation). Target 3.2.2 codes, not the docs page.
2. `Diagnostic` shape to mirror: `{code, fileName, range (0-based line/col), context, severity, message}` — adopting it also fixes the repo's known "Parse errors lack line/column" bug.
3. Per-code severity overrides (`error|warning|info|none`, clamped to each descriptor's minimum) come from the `.yarnproject` `CompilerOptions.DiagnosticsSeverity` map — design the severity enum + clamp now, wire the config later.
4. Three codes (YS0013, YS0014, YS0034) and several others are `generated_in: languageserver`, not compiler — a TS parity target only needs them if it ever grows an LSP/story-IDE surface.
