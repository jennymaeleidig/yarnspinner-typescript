~~support for .yarn / .yarnproject files ... vs code extension and the language server features ... not only for react but other frameworks like next.js and sveltekit~~ → spun out into the `.scratch/yarn-project-support/` effort (ticket 01 landed; 02 loader; 03 Next.js/SvelteKit hosts)

improve architecture && doc updater

need to update stale / pointless artifact references && code provenance  / attribution / citations / cff / force11 - need to license properly as cc0

parity with upstream as it gets updated / future upgrade pipeline - reads to me as agent skill

enforce / adopt prettier


ternary operator: silently mis-compiles instead of diagnosing — `<<declare $x = true ? "A" : "B">>` parses clean (no YS0005) but evaluates to nothing (variable unset). Found during ticket 53's docs pass; behavior changes are out of scope for a release-prep ticket. Fix = parser rejection with a YS0005 pointing at the `<<if>>` branch pattern (docs already corrected; upstream has no ternary).

ParseFailures validation wave: 12 upstream must-fail fixtures still compile clean (the self-cleaning `MUST_FAIL_ALLOWLIST` in `src/tests/upstream-conformance.test.ts`); missing validations = newline-in-command, declare/set value checks, indentation checks, when: header expression checks, jump-target string typing, operator/assignment typing, function/variable type inference. Ticketed as ys32-parity-impl ticket 54 (found by the 2026-09-03 spec-vs-impl review); the allowlist self-cleans as each validation lands with its exact registry code.

pluggable variable storage + `<<call>>` + `<<wait>>` + `///` declaration comments: landed 2026-09-03 as spec-vs-impl review resolutions (stories 39/4/7/47) — listed here only to close the loop; see compatibility.md and the tracker map entry for the wave.
