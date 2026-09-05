## Smart Variables

Source: [docs.yarnspinner.dev — Smart Variables](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/smart-variables) and the 3.2.2 source ([TypeCheckerListener.ResolveInitialValues](https://github.com/YarnSpinnerTool/YarnSpinner/blob/v3.2.2/YarnSpinner.Compiler/TypeCheckerListener.cs), [YS0030](https://github.com/YarnSpinnerTool/YarnSpinner/blob/v3.2.2/YarnSpinner.Diagnostics/Definitions/YS0030-SmartVariableReadOnly.md), [YS0045](https://github.com/YarnSpinnerTool/YarnSpinner/blob/v3.2.2/YarnSpinner.Diagnostics/Definitions/YS0045-SmartVariableLoop.md)).

A **smart variable** is a `<<declare>>`d variable whose value is recomputed on
every access instead of being stored once. Smart variables let dialogue
reference derived state — `$can_afford_pie = $player_money > 10` — without
manually keeping it in sync.

### Declaring

A declaration is a smart variable when its initial value is _anything other
than a plain literal_:

- number literal (`0`, `1.5`), with at most one leading unary minus (`-1` — a
  negative literal is **not** a smart variable, upstream issue #421);
- string literal (`"hello"`);
- `true` / `false`;
- an enum member reference (`Enum.Case`, or the `.Case` shorthand).

Everything else — variable references, operators, function calls, or even a
parenthesized literal like `(1)` — declares a smart variable (upstream
`Declaration.IsInlineExpansion`):

```yarn
<<declare $player_money = 0>>
<<declare $player_can_afford_pie = $player_money > 10>>  // smart variable
```

Smart variables carry no initial value (they are absent from
`Program.InitialValues`), and appear in the compile result's declarations
with `isSmartVariable: true`.

### Read-only

Smart variables cannot be assigned to — `<<set>>` (including compound
assignment) targeting one is the compile error **YS0030**:
`$x cannot be modified (it's a smart variable and is always equal to …)`.

### Reference loops

Smart variables may reference other smart variables, so long as no reference
loop exists (`$E = $C || $C` is fine; `$A → $B → $C → $A` is not). Loops are
the compile error **YS0045**: `Smart variables cannot contain reference loops
(referencing $A here creates a loop for the smart variable A)`.

### Runtime

Values are recomputed on every access — conditions, interpolations, option
conditions, and `tryGetSmartVariable()` (upstream
`Dialogue.TryGetSmartVariable`) all see current values. A host write to a
smart variable's name via the variable storage shadows the expression, as
upstream (`VariableKind.Stored` wins over `VariableKind.Smart`).
