# Command validation is an opt-in analysis surface

`.ysls.json` command/function declarations are read from a project's
`definitions` field, but their use for command-name/arity checking is
deliberately **opt-in** (`CompileOptions.validateCommands`), not part of the
default compile. The check emits `YS0060 UnknownCommand` and
`YS0061 WrongCommandParameterCount`.

## Considered Options

- **Emit from the default compile path.** Simplest reach, but upstream tags
  both codes `generated_in: languageserver` with `minimumSeverity: none`:
  its _compiler_ never produces them. Emitting by default would change every
  project's diagnostics and could fail builds on a warning upstream would not
  emit — silent drift against the parity contract (coding standards §1).
- **A separate `lint()`/`analyze()` entry point** that re-parses. Clean
  separation, but duplicates parsing and the compile-mode machinery, and
  makes the check unavailable to `loadProject` consumers without a second
  file walk.
- **An opt-in compile option** (chosen). The declarations and the check ride
  the existing compile seam; the default path is untouched, and a host that
  wants the language-server's semantics turns it on explicitly.

## Consequences

- Without `validateCommands: true`, compile output and diagnostics are
  byte-identical to before — the regression bar for a host whose editor and
  build disagreed (the motivating consumer).
- The two codes live in `LANGUAGE_SERVER_DIAGNOSTIC_REGISTRY`, separate from
  `DIAGNOSTIC_REGISTRY`, so the conformance golden loop still asserts that no
  language-server code leaks into the compiler's registry. Their vendored
  upstream examples are pinned through the opt-in path instead.
- A malformed or unreadable `.ysls.json` is a `YP0009`/`YP0010` **warning**,
  not an error: declarations are editor tooling and must never fail a build.
  The valid declarations from other files still merge in.
- Function declarations are parsed and carried but the compiler still does
  not consume them for signature checking beyond the existing external
  declarations path; only command count validation is wired here.
