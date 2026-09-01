# 48: Markup runtime module + replacement markers

**What to build:** text rendered to the consumer goes through the upstream markup split — the runtime line-parser module expands `{expr}` substitutions, then parses markup into a structured result (attributes with positions, delete-range, text-for-attribute); replacement markers `[select]`/`[plural]`/`[ordinal]` via `Intl.PluralRules` with overridable locale and invisible-character counts; parser completeness (close-all `[/]`, property shorthand, self-closing trim + `trimwhitespace=false`, attribute types); implicit `[character name=]` marker replaces the regex speaker slice; minimal custom-processor registry; styling tags stay opaque.

Fixture corpus has no markup coverage — verified by ported upstream inline tests against the module directly (seam 2).

**Blocked by:** 43 (tests hit the new API's Line payloads).

**Status:** ready-for-agent

- [ ] Ported upstream markup tests green
- [ ] Replacement markers produce upstream-identical classes and counts
- [ ] Speaker resolution via implicit marker
- [ ] Full suite green
