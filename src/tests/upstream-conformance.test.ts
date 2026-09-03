/**
 * Upstream conformance suite (roadmap phase 0).
 *
 * Drives the vendored Yarn Spinner v3.2.2 corpus through this project's
 * compile → run pipeline:
 *
 * - `TestCases/ParseFailures/*.yarn` (33 files) + `DuplicateLineTags.yarn`:
 *   no `.testplan` ⇒ the fixture MUST fail to compile (upstream asserts
 *   "has errors"; exact YS-codes arrive with the diagnostics channel).
 * - `TestCases/*.yarn` with a sibling `.testplan`: must compile clean, and
 *   the plan's strict step-locked event stream must match.
 *
 * The corpus is pinned by upstream tag (`test/fixtures/upstream/PROVENANCE.md`).
 * Known gaps against the corpus are recorded in explicit allowlists below;
 * each allowlist entry must still be failing (entries self-clean when the
 * underlying gap is fixed), and every entry cites the gap it tracks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, hasErrors } from "../index.js";
import type { ExternalDeclarations } from "../compile/typeCheck.js";
import { parseTestPlan } from "./upstream/testPlan.js";
import { runTestPlan, PlanFailure } from "./upstream/testBase.js";
import { listTestCases, listParseFailures, readFixture } from "./upstream/fixtures.js";

/**
 * Fixtures that upstream requires to FAIL compilation but that this
 * implementation currently accepts. Each entry: fixture name → tracked gap.
 * Populated against the v3.2.2 corpus; entries must be removed as the
 * compiler gains the missing validation (spec stories 15, 21, 29, 51…).
 *
 * Empty since ticket 54 (the ParseFailures validation wave): every vendored
 * must-fail fixture fails with its upstream code. The per-family unit tests
 * live in src/tests/parseFailureValidations.test.ts.
 */
const MUST_FAIL_ALLOWLIST: Record<string, string> = {};

/**
 * Fixtures that must compile clean but currently fail. Each entry cites the
 * missing language feature. Must shrink to empty by phase-1 exit ("all 32
 * fixture .yarn files compile with expected diagnostics").
 */
const COMPILE_CLEAN_ALLOWLIST: Record<string, string> = {};

/**
 * Plan-driven fixtures that currently fail. Each entry cites the runtime gap.
 * Must shrink to empty by phase-2 exit ("testplan runner green on the 32 pairs").
 */
const PLAN_RUN_ALLOWLIST: Record<string, string> = {};

/**
 * Compile-time function signatures for the harness-registered quest stubs
 * (upstream registers these functions with the compilation Library, so the
 * type checker knows their parameter types — ticket 41).
 */
const HARNESS_FUNCTION_SIGNATURES = {
  set_objective_complete: { params: ["string"], returns: "bool" },
  is_objective_active: { params: ["string"], returns: "bool" },
  get_quest_status: { params: ["string"], returns: "string" },
} as const satisfies ExternalDeclarations["functions"];

/**
 * Every plan-driven pair runs on the instruction-stream program (ADR 0001)
 * through the same public runtime API — the tree-IR driver is retired
 * (ticket 46), so there is no per-fixture driver split any more.
 */

function attemptCompile(source: string): { ok: true } | { ok: false; error: string } {
  try {
    const { program, diagnostics } = compileSource(source, {
      declarations: { functions: HARNESS_FUNCTION_SIGNATURES },
    });
    if (program === null || hasErrors(diagnostics)) {
      const first = diagnostics.find((d) => d.severity === "error");
      return { ok: false, error: first ? `${first.code}: ${first.message}` : "compilation failed" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

test("upstream ParseFailures fixtures must fail to compile", async (t) => {
  const failures = listParseFailures();
  assert.ok(failures.length >= 33, `expected the vendored ParseFailures corpus, found ${failures.length}`);
  for (const name of failures) {
    await t.test(name, () => {
      const result = attemptCompile(readFixture(`TestCases/ParseFailures/${name}`));
      if (result.ok) {
        const reason = MUST_FAIL_ALLOWLIST[name];
        assert.ok(
          reason,
          `fixture compiles but is not in MUST_FAIL_ALLOWLIST — it must fail per upstream; ` +
            `if this is a real gap, add an entry citing it`,
        );
      } else {
        assert.ok(
          !(name in MUST_FAIL_ALLOWLIST),
          `stale MUST_FAIL_ALLOWLIST entry for ${name}: fixture now fails as upstream requires — remove the entry`,
        );
      }
    });
  }

  await t.test("DuplicateLineTags.yarn", () => {
    const result = attemptCompile(readFixture("TestCases/DuplicateLineTags.yarn"));
    if (result.ok) {
      const reason = MUST_FAIL_ALLOWLIST["DuplicateLineTags.yarn"];
      assert.ok(reason, "compiles but is not in MUST_FAIL_ALLOWLIST");
    } else {
      assert.ok(
        !("DuplicateLineTags.yarn" in MUST_FAIL_ALLOWLIST),
        "stale MUST_FAIL_ALLOWLIST entry: fixture now fails as upstream requires — remove the entry",
      );
    }
  });
});

test("upstream TestCases fixtures with a plan must compile clean", async (t) => {
  const pairs = listTestCases().filter((name) => name !== "DuplicateLineTags.yarn");
  for (const name of pairs) {
    await t.test(name, () => {
      const result = attemptCompile(readFixture(`TestCases/${name}`));
      if (!result.ok) {
        const reason = COMPILE_CLEAN_ALLOWLIST[name];
        assert.ok(
          reason,
          `compile failed: ${result.error}; if this is a real gap, add a COMPILE_CLEAN_ALLOWLIST entry citing it`,
        );
      } else {
        assert.ok(
          !(name in COMPILE_CLEAN_ALLOWLIST),
          `stale COMPILE_CLEAN_ALLOWLIST entry for ${name}: fixture now compiles — remove the entry`,
        );
      }
    });
  }
});

test("upstream testplan pairs run per plan", async (t) => {
  const pairs = listTestCases().filter((name) => name !== "DuplicateLineTags.yarn");
  for (const name of pairs) {
    const planSource = readFixtureSafe(`TestCases/${name.replace(/\.yarn$/, ".testplan")}`);
    if (planSource === null) continue; // no plan ⇒ compile-only fixture (covered above)
    await t.test(name, () => {
      const result = compileSource(readFixture(`TestCases/${name}`), {
        declarations: { functions: HARNESS_FUNCTION_SIGNATURES },
      });
      // Every pair drives the instruction-stream program (ADR 0001); the
      // tree-IR driver is retired (ticket 46).
      const program = result.program;
      if (!program || hasErrors(result.diagnostics)) {
        throw new Error(`fixture failed to compile: ${result.diagnostics.map((d) => d.code).join(", ")}`);
      }
      const plan = parseTestPlan(planSource);
      if (!program.nodes["Start"]) {
        // Upstream: plans only run when the Start node exists.
        t.skip("no Start node");
        return;
      }
      try {
        runTestPlan(program, plan);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const reason = PLAN_RUN_ALLOWLIST[name];
        assert.ok(
          reason,
          `plan run failed: ${message}; if this is a real gap, add a PLAN_RUN_ALLOWLIST entry citing it`,
        );
        assert.ok(
          e instanceof PlanFailure,
          `unexpected error type: ${message}`,
        );
        return;
      }
      assert.ok(
        !(name in PLAN_RUN_ALLOWLIST),
        `stale PLAN_RUN_ALLOWLIST entry for ${name}: fixture now passes — remove the entry`,
      );
    });
  }
});

test("upstream Example.yarn runs per Example.testplan", () => {
  const result = compileSource(readFixture("Example.yarn"));
  const program = result.program;
  assert.ok(program, "the compile seam emits a program for Example.yarn");
  const plan = parseTestPlan(readFixture("Example.testplan"));
  runTestPlan(program, plan);
});

function readFixtureSafe(relPath: string): string | null {
  try {
    return readFixture(relPath);
  } catch {
    return null;
  }
}
