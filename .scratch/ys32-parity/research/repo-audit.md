# Baseline research: repo capabilities audit (yarn-spinner-runner-ts @ 0.1.5-c)

> Gathered during the charting session (2026, agent audit of src/, tests, docs, git history).
> Diff this against [ys322-census.md](./ys322-census.md).

## Provenance
- package.json: `yarn-spinner-runner-ts@0.1.5-c`, MIT, deps: only `js-yaml`. Dev: react 18, vite, tsc 5.6.
- Not a git fork — fresh `Init commit` 2025-11-03 by "Fabius Instirito"; 11 commits total (latest "fix scene drops"). README credits **oleksii-chekhovskyi/yarn-spinner-runner-ts** as the GitHub repo; origin remote is `jennymaeleidig/yarn-spinner-runner-ts` (maintainer's fork of that). README names `bondage.js` (Yarn 2.x) and YarnBound as inspirations; NOT derived from YarnSpinnerTool/YarnSpinner code.
- `docs/` are verbatim-ish transcriptions of docs.yarnspinner.dev pages (each file cites its source URL) — a reference library, not all implemented.

## Architecture
- `src/parse/lexer.ts` (108 lines): line-based, indentation-sensitive tokenizer (HEADER_KEY/VALUE, NODE_START `---`, NODE_END `===`, OPTION `->`, COMMAND `<<...>>` single-line only, TEXT, INDENT/DEDENT). Multi-line commands not supported.
- `src/parse/parser.ts` (498): recursive descent → `YarnDocument` AST (`src/model/ast.ts`).
- `src/compile/compiler.ts` (183) → `src/compile/ir.ts` (29 lines): **custom IR, NOT upstream Yarn Spinner's Program/bytecode format**. `IRProgram = { enums: Record<name, string[]>, nodes: Record<title, IRNode | IRNodeGroup> }`. `IRInstruction` union: `line`, `command`, `jump`, `detour`, `options` (with nested `block`), `if` (branches), `once` (id + block). No register/VM model — condition strings are re-evaluated by the runtime's string-based evaluator.
- `src/runtime/` runner.ts (707), evaluator.ts (503), commands.ts (193), results.ts (29).
- `src/markup/parser.ts` (382): shared by parser and runtime.
- `src/scene/` (YAML scene/actor system) and `src/react/` (adapter).

## Language features (confidence ratings)

**Lines**
- Character prefix `Name: text` — **fully implemented** (regex at parse; markup sliced after speaker).
- `#hashtags` on lines & options — **implemented** (regex `\s#(\w+)` stripping; stored as `tags`; caveat: regex strips any ` #word`, no "#tag with value" metadata syntax).
- Compiler auto-generates **implicit line IDs**: appends `line:<global-counter-hex>` tag to every line/option lacking one; also injects `lastline` tag on the line preceding an option group. **No explicit line-ID header handling, no string-table/.csv export** (localization: **absent**; only docs/line-groups.md & shadow-lines.md mention "csv" conceptually).
- Inline expressions `{expr}` in line/option text — **implemented** at runtime (interpolation via evaluator, markup-aware re-slicing). Errors silently → empty string.
- Line conditions `<<if>>` attached to a line (upstream allows line-level `<<if $x>>` before a line) — **absent** as such; conditions only via `<<if>>` blocks or option `[if ...]`.

**Statements**
- `<<set>>` — **fully**: `to`, `=`, and bare `var expr` aliases; full arithmetic RHS. No compound assignment (`+= -= *= /= %=`).
- `<<declare>>` — **implemented** (nonstandard: runtime command handler, not compile-time declaration; no type inference/`<<declare ... as type>>` syntax).
- `<<if/elseif/else/endif>>` — **fully** (two syntaxes: `<<if cmd>>` blocks and inline `{if ...}{else if}{else}{endif}` text blocks; both compile to same If IR).
- `<<once>>...<<endonce>>` — **implemented**; caveat: once-seen sets are **module-level globals shared across all YarnRunner instances** (`globalOnceSeen`, `globalNodeGroupOnceSeen`) — a runner-independence bug.
- `<<jump>>`, `<<detour>>` — **fully** (detour = call-stack return). No `<<return>>` statement.
- `<<visit>>` — **absent** (matches upstream: no such statement exists upstream either).
- `<<unset>>` — **absent** (matches upstream: does not exist upstream).
- `<<stop>>` — **stub**: registered handler is an empty no-op ("Dialogue stop marker"); does not halt dialogue.
- `<<wait>>` — **absent**.
- Commands/custom commands — **implemented**: any other `<<...>>` becomes CommandResult; `<<play_sfx>>`/`<<animate>>` etc. are simply forwarded to consumer via `handleCommand` callback (no built-ins). Also emits a `CommandResult` for *every* command (including set/declare), so consumer sees state commands too.
- `<<enum>>`/`<<case>>`/`<<endenum>>` — **partial**: parsed (top-level or in-body), stored as `name → string[] of case names` only; no case values, no enum-typed declarations, no `.Case` shorthand, no enum-typed function params.
- Smart variables — **partial**: `<<declare $v = expr>>` where expr "looks smart" (regex test for operators/refs/function calls) registers a re-evaluated-on-read expression; heuristic, not upstream semantics; `set` converts smart→regular (upstream: smart variables are read-only).

**Node headers / groups**
- `title`, `tags` (→ `nodeTags`), generic header map — **implemented**. `position`/`colorID`: stored in `headers` map only, no special handling (**stub/passthrough**).
- `when:` conditions — **implemented** (multiple `when:` headers → AND-ed list; supports `once`, `always`, expressions). Implemented via **duplicate node titles forming IRNodeGroup**, first-match-wins selection — **no saliency scoring/priority weighting** (docs/saliency.md, storylets primer are reference-only). No compile error when a group member lacks `when:`.
- `group:` header — **absent** (docs/node-groups.md mentions it; not parsed specially).
- `scene:` header + `&css{...}` in headers/lines/options — **implemented (nonstandard extensions)**.

**Options**
- `->` options with indented bodies, nesting — **fully**.
- Conditions: inline `[if expr]` suffix (**implemented, nonstandard** — upstream syntax is `<<if $x>>` on the option line) and `<<if>>` blocks inside bodies. No `<<once>>` on options.
- Option #hashtags, css — **implemented**.

**Markup** (`src/markup/parser.ts`)
- **Implemented**: generic `[tag][/tag]`, self-closing (`[br/]`), attributes (string/number/bool values), escaping `\[ \] \\`, `[nomarkup]` blocks, nested segments; result is `{text, segments[{start,end,wrappers[{name,type,properties}],selfClosing}]}`. Tags named `b, strong, em, small, sub, sup, ins, del, mark, br` typed "default", others "custom".
- **Absent**: close-all `[/]`; property shorthand `[wave=2]`; self-closing whitespace-trim semantics; replacement markers `[select]`/`[plural]`/`[ordinal]`; implicit `[character name=]` marker; markup *meaning* is entirely consumer-side (React layer maps to HTML spans).

## Runtime API surface (`YarnRunner`)
- Constructor: `new YarnRunner(program, { startAt, variables?, functions?, handleCommand?, commandHandler?, onStoryEnd? })`; steps immediately (first result available post-construction).
- Driving: **`advance(optionIndex?)` only** — one method for continue/next/option-select. No `Continue()`/`SetNode()`/`SetSelectedOption()`/`Stop()` named APIs; no `NoOptionSelected` fall-through.
- State exposed: `currentResult: TextResult | OptionsResult | CommandResult | null`, `history: RuntimeResult[]`, `getCurrentNodeTitle()`.
- Callbacks/events: **single `onStoryEnd` callback** (frozen variables snapshot). No NodeStart/NodeComplete/PrepareForLines/DialogueComplete handler set; `handleCommand(cmd, parsed?)` per command.
- Variables: `getVariable`, `setVariable`, `getVariables()` (copies). `$` prefix normalized away on input (mixed `$x`/`x` accepted — diverges from upstream, which requires `$`). No variable-storage interface (plain object).
- Functions: supplied via `options.functions` map; merged over built-ins: `visited, visited_count, format_invariant, random, random_range, dice, min, max, round, round_places, floor, ceil, inc, dec, decimal, int, string, number, bool`. Missing upstream: `has_any_content`, `format(fmt, val)`. Caveats: `random_range` returns float (upstream returns int), `min`/`max`/`floor` etc. take exactly 2 args (arity-restricted, no variadic custom functions).
- Expression evaluator: string-based; comparison/logical/arithmetic; operator aliases `eq/is/neq/gt/lt/lte/gte/and/or/not/xor`; no ternary (note: upstream has no ternary either — fork README example using one is simply wrong). No `+=`-style ops. All arithmetic coerces to number.
- Markup parsing happens at **parse time** (AST) and re-sliced/interpolated in runtime; runtime exposes structured markup on results — consumer must render.

## Compiler / diagnostics
- **No diagnostics system**: `ParseError` exceptions with plain messages (token line/column captured in lexer but **not included in error messages**); no error/warning collection. No node-title uniqueness validation (duplicates intentionally become groups — upstream errors when a group member lacks `when:`), no jump-target validation.
- Output is its own IR; **incompatible** with upstream `Program`/protobuf/line-registry formats (accepted: out of scope).
- No `CompilationJob`-equivalent (file sets, external declarations, Library, CompilationType).

## React layer (named only)
`src/react/`: `useYarnRunner()` hook, `DialogueView.tsx`, `DialogueScene.tsx`, `DialogueExample.tsx`, `MarkupRenderer.tsx`, `TypingText.tsx`, `dialogue.css`. Plus `src/scene/` YAML scene/actor system (`parseScenes`, cross-fade portraits). Self-contained; out of scope for parity, but the vite browser demo (`npm run demo`) must stay green as the acceptance harness.

## Test coverage
- Custom `scripts/run-tests.js` → builds to `dist/`, runs `node --test` on `dist/tests/*.test.js`. **46 `test()` cases** across 11 files: index (1), nodes_lines (2), options (6), variables_flow_cmds (8), once (3), jump_detour (5), markup (5), custom_functions (4), full_featured (1), story_end (1), dialogue_view (2, React).
- **No tests for**: enums, smart variables, node groups/`when:`, implicit line IDs, `{if}` inline syntax, localization, error/parse-error cases.

## Known bugs / smells
- Global once-state across runner instances (`globalOnceSeen`, `globalNodeGroupOnceSeen`).
- `docs/compatibility-checklist.md` is **stale** — describes long-fixed gaps as current.
- `executeBlock()` in runner.ts appears dead (never called); duplicated `emitBlock` in compiler (two copies); `lookaheadIsEnd` re-resolves nodes per line.
- `random_range` returns float vs upstream int; `min`/`max`/`floor`… arity-restricted to 2 args.
- Parse errors lack line/column despite lexer capturing them.
- README documents a ternary the evaluator doesn't support (and upstream doesn't have one either).
