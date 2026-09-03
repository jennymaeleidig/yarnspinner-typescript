~~support for .yarn / .yarnproject files ... vs code extension and the language server features ... not only for react but other frameworks like next.js and sveltekit~~ → spun out into the `.scratch/yarn-project-support/` effort (ticket 01 landed; 02 loader; 03 Next.js/SvelteKit hosts)

improve architecture && doc updater

need to update stale / pointless artifact references && code provenance  / attribution / citations / cff / force11 - need to license properly as cc0

parity with upstream as it gets updated / future upgrade pipeline - reads to me as agent skill

enforce / adopt prettier


ternary operator: silently mis-compiles instead of diagnosing — `<<declare $x = true ? "A" : "B">>` parses clean (no YS0005) but evaluates to nothing (variable unset). Found during ticket 53's docs pass; behavior changes are out of scope for a release-prep ticket. Fix = parser rejection with a YS0005 pointing at the `<<if>>` branch pattern (docs already corrected; upstream has no ternary).

ParseFailures validation wave: ~~12 upstream must-fail fixtures still compile clean~~ landed 2026-09-03 (ys32-parity-impl ticket 54): every vendored must-fail fixture fails with its upstream code and `MUST_FAIL_ALLOWLIST` is empty — newline-in-command (YS0006), declare/set value checks (YS0006/YS0005), indentation, `when:` header expression, jump-target string typing, operator/assignment typing (YS0050), and function/variable type inference (YS0029/YS0014/YS0050); codes verified against the upstream v3.2.2 compiler itself. The two parity-completeness items (bare `<<call>>`, trailing `///` after a declaration) landed in the same wave.

pluggable variable storage + `<<call>>` + `<<wait>>` + `///` declaration comments: landed 2026-09-03 as spec-vs-impl review resolutions (stories 39/4/7/47) — listed here only to close the loop; see compatibility.md and the tracker map entry for the wave.
