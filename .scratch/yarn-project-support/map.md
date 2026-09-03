# Map: Yarn project files & framework-agnostic hosting

Label: wayfinder:map

## Destination

Implement the [spec](spec.md): the repo works as a Yarn Spinner workspace
(VS Code extension + language-server features) via a root `.yarnproject`; the
library gains a framework-agnostic YarnProject loader feeding `compile()`;
Next.js and SvelteKit reference hosts prove support beyond React.

Independent of the [`ys32-parity-impl`](../ys32-parity-impl/map.md) release
wave (tickets 20–53); this effort must not add breaking surface to 0.2.0.
Spec'd from `future-work.md` item 1 before ticket 53 started.

## Tickets

| Ticket | Status | Blocked by |
|---|---|---|
| [01 workspace editor project](issues/01-workspace-editor-project.md) | resolved | — |
| [02 YarnProject loader](issues/02-yarnproject-loader.md) | ready-for-agent | — |
| [03 framework hosts: Next.js + SvelteKit](issues/03-framework-hosts.md) | ready-for-agent | 02 |

## Decisions so far

- **TypeScript-only scope (user decision)**: this library targets TS/JS hosts
  (React, Next.js, SvelteKit, plain Node) — full stop. Upstream-engine
  interoperability (Unity/Godot/Unreal program export, protobuf parity) is
  **permanently out of scope**, not deferred. Sources and localisation flow in
  from upstream-style projects; compiled Programs stay ours (ADR 0001) and
  never need to flow back out to C#/C++ engines.
- Ticket 01: workspace project scopes `sourceFiles` to authored content only;
  vendored conformance fixtures are excluded so editor tooling can never
  flag or auto-fix byte-exact upstream fixtures.
- Ticket 02: file access is injected (Node `fs` is only the default provider)
  so the loader runs under Vite/Next/SvelteKit bundling; `requireVariableDeclarations`
  has no compiler equivalent yet — surface the gap, don't silently ignore.
- Ticket 03: examples, not package surface — no adapter abstraction until a
  second real consumer forces the shape.
