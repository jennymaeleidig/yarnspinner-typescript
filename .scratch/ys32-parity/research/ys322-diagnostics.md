# Research: YS00xx diagnostics catalog (YS0001–YS0047) + applicability mapping

> Research ticket [09](../issues/09-diagnostics-catalog.md). Primary sources:
> 1. **YarnSpinnerTool/YarnSpinner @ `ec1a680` (2026-08-11, ships 3.2.2)** — the authoritative registry is `YarnSpinner.Diagnostics/Definitions/YSxxxx-<Name>.md` (one markdown file per code; YAML front matter carries `code`, `messageTemplate`, `defaultSeverity`, `minimumSeverity`, `published`, `deprecated`, `generated_in`). Compiler emission sites: `ErrorListener.cs` (ANTLR syntax errors), `SyntaxValidationListener.cs`, `TypeCheckerListener.cs`, `NodeGroupCompiler.cs`, `Utility.cs`, `Visitors/*`.
> 2. **docs.yarnspinner.dev** — [Errors page](https://docs.yarnspinner.dev/write-yarn-scripts/yarn-spinner-editor/errors.md) (human-readable table; see "Docs vs source discrepancies" below).

## How upstream diagnostics work (context for ticket 10)

- A `Diagnostic` (in `YarnSpinner.Compiler/ErrorListener.cs`) carries: `Code` (e.g. `"YS0005"`), `FileName`, `Range` (**0-based** line/column), `Context` (source text snippet), `Severity`, `Message` (rendered from the descriptor's template).
- Codes, message templates, and severities are defined **only** in `DiagnosticDescriptor` descriptors generated from the `Definitions/*.md` files — codes are stable API, published since v3.2.0 (early ones) / v3.2.1 (YS0013, YS0014, YS0048, YS0050–YS0053).
- Default severities are overridable **per code** via the `.yarnproject` file's `CompilerOptions.DiagnosticsSeverity` map (`error|warning|info|none`), clamped to each descriptor's `minimumSeverity`. Codes tagged `generated_in: languageserver` (YS0009, YS0013, YS0015, YS0016, YS0034, YS0060, YS0061) are **not emitted by the compiler** — they come from the language server's own analysis.
- YS0036 gating: `PreviewFeatureVisitor` emits it when smart variables, enums, or line groups appear with `projectFileVersion` < 3 (current project file version is 4).

## The catalog (YS0001–YS0047, from source definitions)

Severity = `default / minimum` (min = floor for per-project overrides).

### Errors (default severity: error)

| Code | Name | Message template | Trigger condition | Notes |
|---|---|---|---|---|
| YS0001 | ImplicitVariableTypeConflict | `Variable {0} has been implicitly declared with multiple types: {1}` | Variable used with different implicit types across contexts | **Deprecated v3.2.1 — never emitted** (first implicit declaration wins, so conflict is impossible) |
| YS0002 | TypeMismatch | `Type mismatch: expected {0}, got {1}` | Expression's type doesn't match expectation | **Deprecated v3.2.1 — replaced by YS0050** (catch-all TypeCheckerError) |
| YS0004 | MissingDelimiter | `Missing node delimiter` | Node missing `---` start or `===` end delimiter | |
| YS0005 | SyntaxError | `Syntax error: {0}` | ANTLR parse failure (anything unparseable) | Emitted by `ErrorListener`; carries exact line/col |
| YS0006 | UnclosedCommand | `Unclosed command: missing >>` | `<<` opened, never closed with `>>` | |
| YS0007 | UnclosedScope | `Unclosed scope: expected an <<{0}>> to match the <<{1}>> statement on line {2}` | `<<if>>`/`<<once>>` without matching `<<endif>>`/`<<endonce>>` | Message cites opening line |
| YS0011 | DuplicateNodeTitle | `Duplicate node title: '{0}'` | ≥2 nodes share a title **and** don't form a valid node group (valid group = differing `when:` clauses) | Not emitted for legitimate groups |
| YS0013 | UnknownFunction | `Unknown function {0}` | Call to a function not in the Library / declarations | `generated_in: languageserver`; published 3.2.1 |
| YS0014 | WrongFunctionParameters | `Invalid function call: {0}` | Wrong arity or parameter types (e.g. `visited(1)`) | published 3.2.1 |
| YS0017 | LinesCantHaveLineAndShadowTag | `Lines cannot have both a '#line' tag and a '#shadow' tag.` | Line tagged `#line:x` **and** `#shadow:x` | Shadow lines get no own ID |
| YS0018 | DuplicateLineID | `Duplicate line ID '{0}'` | Same explicit `#line:` ID on two lines in a project | |
| YS0020 | CommandFollowingLine | `Command "{0}" found following a line of dialogue. Commands should start on a new line.` | Line text followed by `<<command>>` on the same line | Only line conditions (`<<if>>`) may follow a line |
| YS0027 | InvalidNodeName | `Unexpected '{1}' in node {0}. Titles can only contain letters, numbers, and underscores.` | Invalid char in `title:` or `subtitle:` | |
| YS0028 | TypeInferenceFailure | `Can't determine type of {0} given its usage. Manually specify its type with a declare statement.` | Variable's type not inferable from usage | |
| YS0029 | ExpressionTypeUndetermined | `Can't determine the type of the expression {0}.` | Expression type unresolvable | |
| YS0030 | SmartVariableReadOnly | `{0} cannot be modified (it's a smart variable and is always equal to {1})` | `<<set>>` targeting a smart variable | |
| YS0031 | NodeGroupMissingWhen | `All nodes in the group '{0}' must have a 'when' clause (use 'when: always' if you want this node to not have any conditions).` | Some nodes sharing a title have `when:`, others don't | |
| YS0032 | DuplicateSubtitle | `More than one node in group {0} has subtitle {1}.` | Same `subtitle:` twice within a node group | |
| YS0035 | EnumDeclarationError | `{0}` | Catch-all for enum declaration problems (mixed raw value types, dup cases, …) | Upstream TODO: split into smaller diags |
| YS0036 | LanguageVersionTooLow | `{0}` | Feature (smart variables, enums, line groups) used with `projectFileVersion` < 3 | Depends on `.yarnproject`; `skip_test_generation: true` |
| YS0037 | InvalidLiteralValue | `{0}` | Constant literal unparseable/wrong type (e.g. enum case = function call) | |
| YS0038 | InvalidMemberAccess | `{0}` | `Type.Member` (e.g. `Enum.Case`) unresolvable | |
| YS0039 | RedeclarationOfExistingVariable | `Redeclaration of existing variable {0}` | Two `<<declare>>` for same variable | |
| YS0040 | RedeclarationOfExistingType | `Can't create a new type {0}: a type with this name already exists` | Duplicate enum/type name | |
| YS0041 | InternalError | `Internal compiler error: {0}` | Unexpected compiler failure | "please file an issue" |
| YS0042 | UnknownLineIDForShadowLine | `Unknown line ID {0} for shadow line` | `#shadow:` references a `#line:` ID that doesn't exist | |
| YS0043 | ShadowLinesCantHaveExpressions | `Shadow lines must not have expressions` | `#shadow:` line contains `{expr}` | |
| YS0044 | ShadowLinesMustHaveSameTextAsSource | `Shadow lines must have the same text as their source` | `#shadow:` line text ≠ source line text | |
| YS0045 | SmartVariableLoop | `Smart variables cannot contain reference loops (referencing {0} here creates a loop for the smart variable {1}).` | Smart variable references itself (directly or through others) | |
| YS0046 | NullDefaultValue | `Variable declaration {0} (type {1}) has a null default value. This is not allowed.` | Declaration with null default | **Deprecated v3.2.1 — unreachable internal error** |
| YS0047 | TypeSolverTimeout | `Expression failed to resolve in a reasonable time ({0}). Try simplifying this expression.` | Upstream's constraint type-solver exceeded its time limit | Mechanism-specific to upstream's Hindley-Milner-ish solver |

### Warnings / info

| Code | Name | Sev (def/min) | Message template | Trigger condition | Notes |
|---|---|---|---|---|---|
| YS0003 | UndefinedVariable | warning / none | `Variable '{0}' is used but not declared. Declare it with: <<declare {0} = value>>` | Variable used without declaration | |
| YS0008 | UnreachableCode | warning / none | `Unreachable code detected` | Statements after `<<jump>>`/`<<return>>`/`<<stop>>` | Upstream TODO: real basic-block analysis |
| YS0010 | UnusedVariable | info / none | `Variable '{0}' is declared but never used` | Declaration never referenced | |
| YS0012 | UndefinedNode | warning / none | `Jump to undefined node: '{0}'` | `<<jump>>`/`<<detour>>` target doesn't exist | |
| YS0016 | UnknownCharacter | info / none | `Unknown character: '{0}'` | Line character name not in project's character list | `generated_in: languageserver` |
| YS0019 | LineContentAfterCommand | warning / none | `Dialogue "{0}" content found following a command. Commands should be on their own line.` | Dialogue text after `<<command>>` on same line | |
| YS0021 | StrayCommandEnd | warning / none | `Stray '>>' without matching '<<'. Did you forget to open the command?` | `>>` with no `<<` | |
| YS0022 | UnenclosedCommand | warning / none | `'{0}' command must be enclosed in '<<' and '>>'. Did you mean '<<{0} ...'?` | Command keyword (`set`, `declare`, `jump`, `detour`) at line start without brackets | |
| YS0033 | EmptyNode | warning / none | `Node "{0}" is empty and will not be included in the compiled output.` | Node has no statements | Present in source registry, **missing from docs errors page** |
| YS0034 | InvalidLibraryFunction | error / — | `Function {0} cannot be used in Yarn Spinner scripts: {1}` | Library function with unusable C# signature | `generated_in: languageserver`; C#-reflection specific |

### Present in docs page but ABSENT from the 3.2.2 source registry

- **YS0023, YS0024, YS0025, YS0026** (docs: wrong enum type / enum type expected / unknown enum member / enum format error) — **no definition file and no occurrence anywhere in the YarnSpinner repo @ `ec1a680` (3.2.2)**. The docs Errors page appears ahead of (or inconsistent with) the shipped compiler. Enum-related errors that *are* shipped fold into YS0035 (catch-all) and YS0038. **Do not hard-code YS0023–0026 into the TS compiler yet.**

### Also in the source registry beyond YS0047 (for completeness)

YS0009 UnreferencedNode (none; LSP) · YS0048 SingularCommandWrap (warning, 3.2.1) · YS0050 TypeCheckerError (error, 3.2.1 — **the live replacement for YS0002**) · YS0051 NodeMissingTitle / YS0052 NodeHasMoreThanOneTitle (error, 3.2.1) · YS0053 DeclarationValueDoesntMatchType (error, 3.2.1) · YS0060 UnknownCommand / YS0061 WrongCommandParameterCount (warning; LSP) · YS0062 MultipleLineOrShadowIDsOnALine (error) · YS0063 MarkupFailedToParse (warning — feeds markup diagnostics into compilation, 3.2.1) · YS0064 RogueChevronWithCommand (warning).

### Docs-page vs source discrepancies (source wins)

- YS0012: docs lists it under **Errors**; source default severity is **warning** (min none).
- YS0021: docs lists it under **Errors**; source default severity is **warning**.
- YS0016: docs lists it under **Warnings**; source default severity is **info**.
- YS0015 (CyclicDependency): docs says warning; source default severity is **info**, min none, `generated_in: languageserver`.
- Docs page omits published codes YS0019, YS0020, YS0033, YS0048, YS0050–0053, YS0060–0064 and invents YS0023–0026. Treat `Definitions/*.md` as ground truth.

## Applicability mapping to yarn-spinner-runner-ts

Based on [repo-audit.md](./repo-audit.md): the TS repo has a hand-written line/indentation lexer (capturing line/col but not reporting them), recursive-descent parser, tree-IR compiler, duplicate-title node groups, jump/detour, once-blocks, name-only enums, heuristic smart variables, a markup parser, and implicit line IDs. It has **no** static type system, no compile-time declarations, no `.yarnproject` model, no shadow lines, no hashtag-value syntax (`#line:abc`), no string table, no Library signature reflection, no code-flow/jump-graph analysis.

Proposed taxonomy (extends the requested three buckets with **deferred** = adopt-when-feature-lands, because "N-A forever" and "N-A until feature X" need different treatment in the diagnostics decision):

### Adopt code as-is (immediately implementable — 12)

| Code | Why now |
|---|---|
| YS0004 | Node delimiter validation is trivial in the existing parser (missing `---`/`===`). |
| YS0005 | Replace `ParseError` throws with collected diagnostics; the lexer already has line/col. |
| YS0006 | Unclosed `<<` detectable at end-of-line (repo commands are single-line anyway). |
| YS0007 | Unterminated `<<if>>`/`<<once>>` stacks are already tracked; report opening line like upstream. |
| YS0012 | Jump/detour target validation against compiled node titles — pure post-pass on the IR. |
| YS0021 | Stray `>>` in text — lexer scan. |
| YS0027 | Title charset validation (letters/numbers/underscores) at node parse. |
| YS0030 | `<<set>>` on a smart variable must error — **also fixes a live divergence** (repo currently converts smart→regular on set; upstream is read-only). |
| YS0031 | Repo already forms groups from duplicate titles; add the "member lacks `when:`" check it's currently missing. |
| YS0033 | Empty-node warning; repo already builds nodes with no statements. |
| YS0041 | Cheap catch-all for internal compiler failures. |
| YS0045 | Cycle detection over the repo's registered smart-variable expressions (same trigger, simpler resolver). |

### Adopt code with adjusted trigger (10)

| Code | Adjustment |
|---|---|
| YS0003 | Upstream requires `<<declare>>`; repo normalizes `$` away and auto-vivifies. Emit once compile-time declarations land; until then, trigger = `<<set>>`/read of a `$var` never declared nor assigned. |
| YS0011 | Repo *intentionally* allows duplicate titles as groups. Emit YS0011 only when duplicates don't form a valid group (i.e. any member lacks `when:`) — overlapping with YS0031; upstream's split is YS0011 = invalid duplicate set, YS0031 = group member missing `when:`. |
| YS0013 | Check function name against the runner's `functions` map + built-ins at compile time (no Library reflection needed). |
| YS0014 | Same source: arity/type check against known signatures (repo already restricts built-in arities). |
| YS0019 | Repo lexer treats `<<cmd>>` as a single-line token; define trigger as trailing non-whitespace text after `>>` on the same line (upstream's `SyntaxValidationListener` equivalent). |
| YS0020 | Trigger = TEXT line containing an embedded `<<command>>` (excluding line conditions, which the repo doesn't support yet). |
| YS0022 | Trigger = line starting with a command keyword (`set|declare|jump|detour|wait|stop`) not enclosed in `<<>>`. Adjusted because the repo's bare `var expr` set-alias makes keyword detection looser. |
| YS0032 | Requires the repo to actually parse/keep `subtitle:` headers (currently generic header map); check uniqueness within duplicate-title sets. |
| YS0035 | Repo enums are name-only; emit as the catch-all once `<<case>>` values are implemented (trigger adjusted to the partial feature). |
| YS0063* | (beyond range, for ticket 10) markup-parse diagnostics — repo has a markup parser to hook. |

### Deferred — adopt when the feature lands (10)

| Code | Blocked on |
|---|---|
| YS0010, YS0039 | Compile-time `<<declare>>` tracking. |
| YS0018 | Hashtag **value** syntax (`#line:abc`) — repo's `\s#(\w+)` regex can't see IDs. |
| YS0037, YS0038, YS0040 | Enum raw values + `.Case` member access (repo enums are name lists). |
| YS0042, YS0043, YS0044 | Shadow lines (`#shadow:`), which the repo lacks entirely. |

### N-A (14)

| Code | Why |
|---|---|
| YS0001 | Deprecated v3.2.1, never emitted upstream — skip. |
| YS0002 | Deprecated v3.2.1, replaced by **YS0050**. When the TS repo adds type checking, emit YS0050, not YS0002. (Ticket's assumption that YS0002 is applicable is outdated by one point release.) |
| YS0009, YS0015, YS0016 | `generated_in: languageserver`; YS0016 additionally needs a project character list. Revisit YS0016 only if the scene/actor system is ever wired to compiler config. |
| YS0023–YS0026 | Not in the 3.2.2 source registry at all (docs-only anomaly). Reserve the numbers; don't emit. |
| YS0034 | C#-reflection signature check in the language server — meaningless in TS. |
| YS0036 | Requires the `.yarnproject`/`projectFileVersion` model the repo doesn't have (repo has no project file, so nothing can be "too low"). N-A until the multi-file/project decision. |
| YS0046 | Deprecated v3.2.1, unreachable. |
| YS0047 | Tied to upstream's constraint type-solver time limit; the TS repo has no solver. |

## Recommendation for ticket 10 (diagnostics decision)

1. **Adopt the YS-code scheme and the `Diagnostic` shape** (code, fileName, 0-based range, context, severity, message) — the repo's ParseError already discards the lexer's line/col, so this is also the fix for that bug.
2. **Target the 3.2.2 registry, not the docs page**: YS0050 is the live type-error code; YS0023–0026 don't exist upstream; severities per source definitions (docs page is stale in ≥4 places).
3. Ship the 12 adopt-as-is codes first (they also close known parity gaps: YS0030/YS0031/YS0012), plan the 10 adjusted-trigger ones alongside compile-time declarations and function-signature checks, and keep a reserved-numbers table for the deferred/N-A codes.
4. Mirror upstream's per-code severity override mechanism (`error|warning|info|none` per code) only if/when a `.yarnproject`-equivalent config lands — the enum (`DiagnosticSeverity`) and min-severity clamp are worth designing in now.
