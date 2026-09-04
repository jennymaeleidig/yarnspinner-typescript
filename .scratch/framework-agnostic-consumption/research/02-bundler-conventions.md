# Research 02 — Bundler virtual-module conventions and precedents

Ticket: [`issues/02-bundler-conventions.md`](../issues/02-bundler-conventions.md)
Method: primary sources only — official docs and source repos, read directly (fetched 2026-08-27). Per-claim citations inline.

---

## 1. Vite virtual-module conventions

**Source: https://vite.dev/guide/api-plugin (official plugin guide, Vite 8 / Rolldown era); rolldown plugin conventions referenced from it.**

- **Virtual module id scheme.** The documented pattern: user-facing id `virtual:my-module`; the plugin's `resolveId` returns `'\0' + virtualModuleId` and `load` matches on that `\0`-prefixed id.
  > `const virtualModuleId = 'virtual:my-module'`
  > `const resolvedVirtualModuleId = '\0' + virtualModuleId`
  (vite.dev/guide/api-plugin, "Importing a Virtual File".) The full convention lives in Rolldown's docs ("Virtual Modules Convention", https://rolldown.rs/apis/plugin-api#virtual-modules) — Vite now extends Rolldown's plugin interface and points there for the convention itself.
- **`\0` in the browser.** Since `\0` is not a permitted char in import URLs, a `\0{id}` id is served in dev as `/@id/__x00__{id}` and decoded back *before* entering the plugin pipeline — plugin hook code never sees `__x00__`. (vite.dev/guide/api-plugin, same section.)
- **`resolveId`/`load`.** Both are called per incoming module request during dev (same container semantics as Rolldown build hooks). `resolveId` maps the bare specifier to the resolved id; `load` returns code for resolved ids. Rolldown adds object-hook `filter: { id: regex }` (also supported by Rollup ≥4.38 and Vite ≥6.3), with in-handler re-checking recommended for backward compatibility. (vite.dev/guide/api-plugin, "Rolldown Hooks" + "Hook Filters".)
- **`enforce: 'pre'`.** Plugin ordering: Alias → user `enforce:'pre'` → Vite core → user (no enforce) → Vite build → user `enforce:'post'` → post build plugins. (vite.dev/guide/api-plugin, "Plugin Ordering".) `enforce: 'pre'` is the documented way to run *before* Vite core plugins — `vite-plugin-svgr` uses exactly `enforce: "pre", // to override \`vite:asset\`'s behavior` (src/index.ts, pd4d10/vite-plugin-svgr).
- **`handleHotUpdate`.** Vite-specific hook (ignored by Rollup). Receives `HmrContext { file, timestamp, modules, read, server }`; may narrow `modules`, return `[]` + `server.ws.send({type:'full-reload'})`, or drive custom client HMR events injected via the plugin's own `transform`. (vite.dev/guide/api-plugin, "handleHotUpdate".) It is a **Vite-only hook** — Rollup ignores it, and unplugin has no equivalent (see §2).
- **Built-in `?raw`/`?url` suffixes.** Vite core handles `?url` (explicit URL import), `?raw` (import as string), `?inline`/`?no-inline`, `?worker`/`?sharedworker` (vite.dev/guide/assets). Two plugin-side behaviors follow from the precedents (§3): (a) a plugin compiling a custom extension must **bail on ids whose query is `raw` or `url`** so core asset handling wins — `@mdx-js/rollup` special-cases exactly this, citing vitejs/vite#22417; `@sveltejs/vite-plugin-svelte` bypasses `query.url` and raw/direct queries to Vite core; (b) unknown extensions like `.yarn` never reach asset handling unless the host adds them to `assetsInclude`, so the plugin's own hooks see them first.

## 2. unplugin — cross-bundler coverage

**Source: repo unjs/unplugin (README, `src/define.ts`, `src/types.ts`, `src/webpack/index.ts`; docs site unplugin.unjs.io).**

- `createUnplugin` returns adapters for **esbuild, rollup, vite, rolldown, webpack, rspack, rsbuild, farm, unloader, bun** (+ `raw` factory). There is **no Turbopack adapter** — Turbopack appears nowhere in the source or docs (`grep turbopack` over repo: zero hits). (src/define.ts.)
- Unified hook surface (`src/types.ts`): `resolveId`, `load`, `transform` (each with optional `filter`), `buildStart`, `buildEnd`, `watchChange`, `writeBundle`; `enforce: 'pre' | 'post'`; context `error`/`warn` taking an `UnpluginMessage { message, id, loc: {line, column, file}, pluginCode, ... }`. Deprecation note marks `loadInclude`/`transformInclude` as legacy in favor of filters.
- **No HMR hook.** unplugin exposes no `handleHotUpdate`; the escape hatch is per-framework partials: `vite?: Partial<VitePlugin>` (also `rollup`, `webpack: (compiler) => void`, `esbuild.setup`, …) — so a Vite-only hook can be attached to an otherwise-unified plugin. (src/types.ts, `UnpluginOptions`.)
- **Virtual modules are handled per-bundler under the hood.** On webpack, unplugin maps resolveId results that don't exist on disk to an absolute fake prefix `resolve(context, '_virtual_') + encodeURIComponent(id)`, backed by `webpack-virtual-modules`; it decodes the prefix before invoking `load`. (src/webpack/index.ts, `VIRTUAL_MODULE_PREFIX`.) So plugin authors write plain `resolveId`/`load` and unplugin translates.
- **Id consistency across bundlers is an explicit test target** (`test/unit-tests/id-consistency/`), including query-carrying ids (`test/fixtures/transform/…/query.js`); Vite/Rollup keep the query in the id passed to hooks.
- **Turbopack is not reachable via unplugin.** Next.js/Turbopack has no JS plugin API; its extension point is `next.config.js` → `turbopack.rules` mapping globs to **webpack loaders** (loader-runner subset: no `importModule`/`loadModule`, no `emitFile`, only JS-returning loaders; query matching via `condition.query`; also `turbopackLoader` import attributes). (nextjs.org/docs/app/api-reference/config/next-config-js/turbopack.) That path consumes a *webpack loader*, not an unplugin webpack *plugin* — although Next's webpack mode (`next-config-js/webpack`) can consume an unplugin webpack plugin. Next is not on unplugin's supported list either way.

**Verdict for the unplugin question:** unplugin genuinely covers webpack/esbuild (official adapters + fixture tests across all ten targets), but (a) it costs the Vite-specific surface (`handleHotUpdate`, dev-server middleware, Vite logger) unless routed through the `vite:` partial escape hatch, and (b) **no abstraction covers Turbopack** — Next's Turbopack story is a plain webpack loader. So the honest boundary is: Vite plugin = deep integration; webpack/Turbopack = a thin hand-written loader over the same compile function; unplugin is the middle path only if the same plugin artifact must also target esbuild/rolldown/farm/bun day one.

## 3. Precedents

### `@mdx-js/rollup` (mdx-js/mdx, packages/rollup/lib/index.js)

- **File transform, not a virtual module.** MDX compiles *real* files via the `transform` hook with `@rollup/pluginutils` `createFilter(include, exclude)`. Virtual ids would be needed only for plugin-internal glue.
- **Query handling:** `const [path, query] = id.split('?')` then
  > `// Special case for Vite. // <https://github.com/vitejs/vite/issues/22417>`
  > `if (query === 'raw' || query === 'url') { return }`
  — i.e. respect Vite's built-in suffixes by opting out.
- **Diagnostics:** runs processors over a `VFile`. **Fatal errors** surface because `formatAwareProcessors.process(file)` throws → build error. **Non-fatal messages** go to `this.warn(...)` / `this.info(...)` as Rollup logs: `{ message: message.reason, cause: message, loc: { file, line, column }, pluginCode: source + ':' + ruleId }`.
- **Types:** the plugin ships none; types for `import X from './post.mdx'` come from the **`@types/mdx`** DefinitelyTyped package, which ships ambient `declare module "*.mdx" { export default function MDXContent(props: MDXProps): Element }` plus `*.md`/`*.markdown`/… aliases, with documented per-file narrowing via an adjacent `my-component.mdx.d.ts` and module augmentation for plugin-added exports. JSX typing is via augmenting `mdx/types.js` with the framework's JSX namespace. (DefinitelyTyped/types/mdx/index.d.ts; mdxjs.com/docs/getting-started §Types.)

### `vite-plugin-svgr` (pd4d10/vite-plugin-svgr)

- **`load` hook, not transform**, `include` defaulting to `"**/*.svg?react"` — the **`?react` query param** selects the plugin's behavior, and the plugin strips the query (`id.replace(/[?#].*$/s, '')`) to read the file. `enforce: 'pre'` to beat `vite:asset`.
- **Types:** ships a referenceable `client.d.ts` containing `declare module "*.svg?react" { … }`; host adds `/// <reference types="vite-plugin-svgr/client" />` to `vite-env.d.ts`. (repo `client.d.ts`, README.)
- **Diagnostics:** svgr failures throw out of `load` → standard bundler error path (no custom shaping).

### `@sveltejs/vite-plugin-svelte` (sveltejs/vite-plugin-svelte, packages/vite-plugin-svelte/src)

- **`transform` hook** with an id parser that splits filename + query into a typed request (`parseRequestQuery`, own `?svelte`/`?raw`/`?direct`/`?url` vocabulary); `query.url` and raw/direct requests bypass the plugin so Vite core handles them.
- **Diagnostics:** compile errors are re-thrown as **RollupErrors** shaped for Vite display — `toRollupError` sets `id: filename`, a clickable `message` (filename:line:column), `frame`, `code`, and `loc: { line, column, file }`; there is a parallel `toESBuildError` mapping to esbuild `PartialMessage.location`. Compiler **warnings** are logged (not thrown) via `logCompilerWarnings` → Vite logger.
- **HMR:** dedicated hot-update plugin (`src/plugins/hot-update.js`, Vite `handleHotUpdate`).
- **Types:** the plugin ships no d.ts for `*.svelte` imports; editor types come from the language-tools (`svelte2tsx`) side — a reminder that the d.ts question for a *file* import can be solved ambiently without the plugin shipping it.

### GraphQL loader precedent (Next-side)

`graphql-tag/loader` appears in Next's Turbopack docs as a webpack loader tested with `turbopack.rules` (nextjs.org/docs/app/api-reference/config/next-config-js/turbopack, "Supported loaders") — i.e. the compile-at-import precedent on the Next/Turbopack path is loader-shaped, not plugin-shaped.

## 4. Framework-support boundary

- **SvelteKit = Vite.** Official docs: SvelteKit provides its dev experience "by leveraging [Vite] with a Svelte plugin … to do Hot Module Replacement (HMR)" (svelte.dev/docs/kit/introduction, "SvelteKit vs Svelte"). A Vite plugin therefore covers SvelteKit first-class — consistent with the map's out-of-scope note ("SvelteKit stays covered via Vite + vanilla runtime").
- **Next.js = webpack/Turbopack, no Vite.** Next's documented customization surfaces are `next.config.js` webpack config and `turbopack.rules` (webpack loaders) / `turbopackLoader` import attributes / module `type: 'raw'` (nextjs.org/docs/app/api-reference/config/next-config-js/{webpack,turbopack}). No Vite plugins. This fixes the docs' boundary statement: the Vite plugin covers Vite-based frameworks (incl. SvelteKit); Next consumes via the documented generic loader contract (webpack loader; works under Turbopack's loader subset) or the existing SSR `loadYarnProject` path.

---

## Recommendation table

| Decision | Recommendation | Basis |
|---|---|---|
| **Virtual-module id scheme** | For `.yarn`/`.yarnproject` *file imports*, compile in-place like the precedents (mdx/svelte: `transform`; svgr: `load` on the real id) — no virtual ids needed for files. Use `virtual:yarn-spinner/…` ids *only* for plugin-internal glue, resolved to `\0virtual:yarn-spinner/…` in `resolveId`; plugin code must never see `__x00__` (Vite decodes before hooks). | vite.dev/guide/api-plugin (convention); mdx/svelte/svgr all compile real files |
| **Query-param handling** | Split ids on `?`; bail when query is `raw`/`url`/`inline`/`no-inline` (Vite core owns these; mdx-js cites vitejs/vite#22417). `?raw` stays locked as the source-string escape hatch. Add own suffixes only if needed (svgr-style `?react` precedent), keep them off the default import. Match plugin filter on the extension before the query. | @mdx-js/rollup; vite-plugin-svgr; vite-plugin-svelte; vite.dev/guide/assets |
| **Diagnostic surfacing** | Fatal compile errors: throw a RollupError-shaped object with `id` (real file path), `loc: {line, column, file}`, `frame`/clickable `message`, `code` (vite-plugin-svelte's `toRollupError` is the model). Non-fatal: `this.warn` with `loc` + `pluginCode` (mdx-js pattern). Ship a source map from the compile. | @sveltejs/vite-plugin-svelte src/utils/error.js; @mdx-js/rollup `vfileToRollup` |
| **unplugin vs Vite-only** | **Vite-only plugin** with the compile step extracted as a pure, bundler-agnostic function. Rationale: unplugin covers 10 bundlers but (a) hides Vite-specific hooks (HMR!) behind the `vite:` escape hatch, (b) has no Turbopack story — Next/Turbopack accepts only webpack loaders regardless. A thin webpack loader (works in Next webpack mode *and* Turbopack `turbopack.rules`) over the same function is the later cross-bundler path; adopt unplugin only if esbuild/rolldown/farm targets become a day-one requirement. | unplugin src/{define,types}.ts + tests; Next turbopack docs |
| **d.ts strategy** | Ship a **referenceable client d.ts** in the plugin package (`vite-plugin-yarn-spinner/client` → `declare module "*.yarn" { … }`, `declare module "*.yarn?raw" { … }`, `declare module "*.yarnproject" { … }`), host enables it with `/// <reference types="…/client" />` in `vite-env.d.ts` — vite-plugin-svgr's convention. Also document the zero-dependency fallback: a `declare module '*.yarn'` snippet the host pastes (svgr's own d.ts is cribbed from CRA's react-app.d.ts, showing both shapes are accepted). Per-file narrowing (adjacent `.d.ts`, @types/mdx pattern) is out of scope. | pd4d10/vite-plugin-svgr client.d.ts + README; DefinitelyTyped/types/mdx |