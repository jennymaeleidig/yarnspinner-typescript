# 05: Next.js host rewritten against the vanilla runtime

**What to build:** `examples/nextjs-host/` keeps its architecture story — the SSR `loadYarnProject` path, the RSC split, prerender — and swaps the client interaction layer from the React adapter to the vanilla runtime (`Dialogue` + `Transcript` driven from a client component with plain React state, no adapter import). The host test (`nextjsHost.test.tsx`) is rewritten without `react-dom/server`'s adapter-coupled rendering — it still proves the host renders and runs dialogue, but against the vanilla layer.

**Notes for the executor:**

- The per-opinion shape comes from ticket 03's decisions (scheduling, typing, markup).
- The SvelteKit host and its test are out of scope — but if the rewritten Next host makes the SvelteKit test's "zero React" assertion stale or trivially true repo-wide, note it in the Answer rather than editing that test here.

**Blocked by:** 02 (adapter gone), 03 (ownership decisions).

**Status:** resolved

## Answer

`examples/nextjs-host/` is now fully vanilla-runtime. The client component never imported the adapter (per the ticket-01 audit, the host was always adapter-free) — the work here was the deletion-shaped pass on it per ticket 03, de-Reacting the test's SSR harness, and closing the React devDeps question.

**`app/DialogueHost.tsx` — rewritten, deletion-shaped ("just a demo", ticket 03):** construct `Dialogue`, read `Transcript` raw, act on input, repeat. Plain React state (`useRef` for the imperative `Dialogue`/`Transcript` + a pure version counter in `useState`); all mutations live in event handlers, never in state updaters — StrictMode (`reactStrictMode: true` in next.config) double-invokes updaters, which would double-pull the shared `Dialogue`. Plain-text rendering: lines with speaker, surfaced commands as plain text, options as buttons plus a `noOptionSelected` fall-through, manual Continue, and Reset (fresh `Dialogue` = fresh variable storage). The first pull still runs synchronously during render, so the opening line is in the SSR markup with no effects — the SSR story is unchanged. Dropped as presentation beyond the rulings: the story-variables chip section, the aria-live status line, and the ~120 lines of inline style objects. Added the repo's missing `// SPDX-License-Identifier: CC0-1.0` header. `page.tsx` and `layout.tsx` untouched — the SSR `loadYarnProject` path and the RSC program-prop split stand as ruled.

**`src/tests/nextjsHost.test.tsx` → `src/tests/nextjsHost.test.ts` (renamed — no JSX remains):** `react`/`react-dom/server` imports and the `MirroredHost` + `renderToStaticMarkup` harness deleted. The SSR pin is re-expressed against the vanilla layer: the test runs the exact pull the client component's first render runs (fresh `Dialogue` + one `runUntilStopped`) and asserts the opening Narrator line and speaker. Every acceptance pin survives verbatim: server-side `loadYarnProject` load (sources + project name), program JSON-serializability across the RSC boundary, `dist/index.js` Node-builtin purity, buy-the-map flow + variable-storage reset, walk-on path, `noOptionSelected` fall-through. The stale compiled artifacts of the old `.tsx` (`dist/tests/nextjsHost.test.*`) were deleted so the old React harness cannot linger in the test glob.

**React devDeps closure (ticket 02's recorded deviation):** after the rewrite, `src/` and `scripts/` contain zero `react`/`react-dom`/`jsdom` references (verified by grep). Per-package call: `react`, `react-dom`, `@types/react`, `@types/react-dom` **stay** — `examples/nextjs-host` is a genuine Next.js app (Next requires react/react-dom as peers; the app's `.tsx` files type-check against `@types/react`). `jsdom` and `@types/jsdom` **removed** — their only consumer was the deleted `clientDomHarness.ts`; lockfile regenerated (`npm install`, −1107 lines). `@vitejs/plugin-react` was already gone (ticket 04). Remaining config usage closed: root `tsconfig.json` drops `"jsx": "react-jsx"` and the empty `src/**/*.tsx` include glob (matching ticket 02's lint-glob removal); `examples/nextjs-host/tsconfig.json` is Next's own and keeps its jsx setting.

**Same-change staleness fix (coding standard §7):** the host README's Tests paragraph updated to the vanilla `.ts` harness (it named the `.tsx` and the browser demo-harness mirroring).

**SvelteKit note (per the ticket's instruction to note, not edit):** `sveltekitHost.test.ts`'s zero-React assertions scan `examples/sveltekit-host`'s own source tree only — scoped to that host, so they are neither stale nor trivially true repo-wide; untouched. Related stale comment left for ticket 06: `src/tests/index.test.ts:50-52` still says the dist/tests exclusion exists partly for "nextjsHost.test.js's JSX until ticket 05 de-Reacts its harness" — the harness is now de-Reacted (the exclusion itself remains necessary for index.test.ts's own literal). Out of my permitted paths, so noted here.

**Gate results:** `npm test` → 627 tests, 626 pass, 0 fail, 1 skip (the pre-existing upstream skip); `npm run lint` green; `npm run ts-check` green; `npm run host:build` green — `next build` succeeds, the route is statically prerendered, and the built `.next/server/app/index.html` carries the opening line ("A crossroads at dusk"), the Narrator speaker, and the Continue/Reset controls, proving the SSR story end-to-end.

**Deviations:** none beyond the notes above.

## Comments
