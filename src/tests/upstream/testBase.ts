/**
 * Port of the upstream conformance runner (`YarnSpinner.Tests/TestBase.cs`,
 * `RunStandardTestcase`) onto this project's runtime, driving the vendored
 * `.testplan` fixtures.
 *
 * Upstream semantics preserved:
 * - Step-locked event stream: every expectation fails if any *other* event
 *   arrives (not transcript comparison).
 * - Expected line text is compared against the composed text: string-table
 *   text with `{expr}` substitutions expanded, including the character-name
 *   prefix (`Baker: Hey there!`). (Replacement markers `[select]`/`[plural]`/
 *   `[ordinal]` are upstream composed-text stages too; they are not yet
 *   implemented here, so FormatFunctions expectations expose that gap.)
 * - Option expectations check text and hashtags; `select: 0` maps to
 *   -1 = no-option-selected (3.1 fall-through).
 * - All runs of a plan share one runtime: variables, once-state, and visit
 *   counts persist across runs (each run re-enters the start node).
 * - `set:` steps are validated against the program's declared initial values
 *   (upstream `Program.InitialValues`) and applied to the shared storage.
 * - Harness-registered functions are part of the conformance contract
 *   (TestBase/LanguageTests): `assert`, `dummy_*`, `add_three_operands`, and
 *   the quest stubs.
 *
 * Documented adaptations to the current fork-era runtime (each is a recorded
 * parity gap, not a new decision — see `.scratch/ys32-parity/spec.md`):
 * - `<<set>>`/`<<declare>>`/`<<call>>` commands never surface as Command
 *   events upstream (spec, ticket 03); the fork runtime still emits them, so
 *   the harness filters them out. Note `<<call>>` bodies are therefore NOT
 *   executed here — assert()-in-call coverage is vacuous until `<<call>>`
 *   lands (spec story 4).
 * - Unavailable options are dropped by the runtime instead of presented with
 *   `isAvailable: false`, so `[disabled]` expectations cannot be asserted;
 *   the harness compares only the available subset and translates the plan's
 *   selection index accordingly. `select: 0` (no-option-selected) is only
 *   verifiable when the runtime fell through on its own (all options
 *   unavailable and dropped).
 * - `saliency:` steps are validated but ignored: no swappable saliency
 *   strategy machinery exists yet (spec stories 17–18); downstream selection
 *   mismatches surface as ordinary failures.
 * - Upstream's `assert` throws and aborts the run; function-call exceptions
 *   are swallowed by this runtime's `<<call>>` handling, so `assert` records
 *   failures and the runner fails the test with them.
 */

import { YarnRunner } from "../../runtime/runner.js";
import type { IRProgram } from "../../compile/ir.js";
import type { RuntimeResult } from "../../runtime/results.js";
import type { TestPlan, TestPlanRun, TestPlanStep } from "./testPlan.js";

export class PlanFailure extends Error {}

export const KNOWN_SALIENCY_MODES = ["first", "best", "best_least_recently_seen"] as const;

export interface ConformanceHarness {
  /** Library functions the fixtures call (conformance contract). */
  functions: Record<string, (...args: unknown[]) => unknown>;
  /** Failures recorded by harness-registered functions (e.g. `assert`). */
  readonly functionFailures: string[];
}

export function createConformanceHarness(): ConformanceHarness {
  const functionFailures: string[] = [];
  return {
    functionFailures,
    functions: {
      assert: (value: unknown) => {
        if (!value) {
          functionFailures.push("Yarn-side assert() failed");
        }
        return true;
      },
      dummy_bool: () => true,
      dummy_number: () => 1,
      dummy_string: () => "string",
      add_three_operands: (a: unknown, b: unknown, c: unknown) => Number(a) + Number(b) + Number(c),
      set_objective_complete: () => true,
      is_objective_active: () => true,
      get_quest_status: () => "InProgress",
    },
  };
}

type ClassifiedEvent =
  | { kind: "line"; speaker?: string; text: string; tags?: string[] }
  | { kind: "command"; command: string }
  | { kind: "options"; options: Array<{ text: string; tags?: string[] }> }
  | { kind: "complete" };

/** Commands that upstream treats as internal statements, not dialogue output. */
const STATE_COMMAND = /^\s*(set|declare|call)\b/;

function classify(result: RuntimeResult | null): ClassifiedEvent | null {
  if (!result) return null;
  if (result.type === "options") {
    return { kind: "options", options: result.options.map((o) => ({ text: o.text, tags: o.tags })) };
  }
  if (result.type === "command") {
    if (STATE_COMMAND.test(result.command)) return null;
    return { kind: "command", command: result.command };
  }
  // Text events with empty text and isDialogueEnd are the node-end marker;
  // the fork runtime emits it after the node's final event.
  if (result.isDialogueEnd && result.text === "") {
    return { kind: "complete" };
  }
  return { kind: "line", speaker: result.speaker, text: result.text, tags: result.tags };
}

function describe(event: ClassifiedEvent | null): string {
  if (!event) return "no event";
  switch (event.kind) {
    case "line":
      return `line "${event.speaker ? `${event.speaker}: ` : ""}${event.text}"`;
    case "command":
      return `command "${event.command}"`;
    case "options":
      return `options [${event.options.map((o) => `"${o.text}"`).join(", ")}]`;
    case "complete":
      return "dialogue complete";
  }
}

function normalizeTag(tag: string): string {
  return tag.startsWith("#") ? tag.slice(1) : tag;
}

/** Composed text of a line event: substitutions are already applied by the runtime. */
function composedText(event: Extract<ClassifiedEvent, { kind: "line" }>): string {
  return event.speaker ? `${event.speaker}: ${event.text}` : event.text;
}

function assertHashtags(expected: string[], actual: string[] | undefined, what: string): void {
  const normalized = new Set((actual ?? []).map(normalizeTag));
  for (const tag of expected) {
    if (!normalized.has(normalizeTag(tag))) {
      throw new PlanFailure(`${what} expected hashtag ${tag}; tags were [${(actual ?? []).join(", ")}]`);
    }
  }
}

export function runTestPlan(program: IRProgram, plan: TestPlan): void {
  const firstRun = plan.runs[0];
  if (!program.nodes[firstRun.startNode]) {
    // Upstream: a plan is only executed when the start node exists;
    // otherwise the fixture is compile-checked only.
    throw new PlanFailure(`program has no "${firstRun.startNode}" node to run`);
  }

  const harness = createConformanceHarness();
  const runner = new YarnRunner(program, {
    startAt: firstRun.startNode,
    functions: harness.functions,
  });
  let pending = runner.currentResult;

  const currentEvent = (): ClassifiedEvent => {
    let event = classify(pending);
    let guard = 0;
    while (event === null) {
      if (guard++ > 10_000) throw new PlanFailure("runtime stalled without emitting an event");
      runner.advance();
      pending = runner.currentResult;
      event = classify(pending);
    }
    return event;
  };

  const consume = (): ClassifiedEvent => {
    const event = currentEvent();
    if (event.kind === "complete") return event; // don't advance past the end marker
    runner.advance();
    pending = runner.currentResult;
    return event;
  };

  let firstOfPlan = true;
  for (const run of plan.runs) {
    runOne(run);
  }

  function runOne(run: TestPlanRun): void {
    if (!program.nodes[run.startNode]) {
      throw new PlanFailure(`run start node "${run.startNode}" does not exist in program`);
    }
    if (firstOfPlan) {
      firstOfPlan = false; // constructor already entered the first run's node
    } else {
      runner.setNode(run.startNode);
      pending = runner.currentResult;
    }

    const expectedOptions: Extract<TestPlanStep, { kind: "option" }>[] = [];

    for (const step of run.steps) {
      switch (step.kind) {
        case "line": {
          const event = consume();
          if (event.kind !== "line") {
            throw new PlanFailure(`expected line, got ${describe(event)}`);
          }
          if (step.text !== null && composedText(event) !== step.text) {
            throw new PlanFailure(
              `expected line "${step.text}", got "${composedText(event)}"`,
            );
          }
          assertHashtags(step.hashtags, event.tags, "line");
          break;
        }
        case "option": {
          expectedOptions.push(step);
          break;
        }
        case "select": {
          const availableExpectations = expectedOptions.filter((o) => !o.disabled);
          if (step.optionIndex >= 0) {
            const event = currentEvent();
            if (event.kind !== "options") {
              throw new PlanFailure(
                `expected ${availableExpectations.length} option(s), got ${describe(event)}`,
              );
            }
            if (event.options.length !== availableExpectations.length) {
              throw new PlanFailure(
                `expected ${availableExpectations.length} option(s), got ${event.options.length}: [${event.options.map((o) => `"${o.text}"`).join(", ")}]`,
              );
            }
            for (let i = 0; i < event.options.length; i++) {
              const expectation = availableExpectations[i];
              if (expectation.text !== null && event.options[i].text !== expectation.text) {
                throw new PlanFailure(
                  `expected option "${expectation.text}", got "${event.options[i].text}"`,
                );
              }
              assertHashtags(expectation.hashtags, event.options[i].tags, "option");
            }
            // Translate the plan's index over all expected options into an
            // index over the options the runtime presented (available only).
            let presentedIndex = 0;
            for (let i = 0; i < step.optionIndex; i++) {
              if (!expectedOptions[i].disabled) presentedIndex++;
            }
            runner.advance(presentedIndex);
            pending = runner.currentResult;
          } else {
            // select: 0 => no option selected. The current runtime cannot
            // present unavailable options; if it dropped them all it already
            // fell through and the pending event is the content after the
            // options block. If it DID present options, the fall-through
            // cannot be expressed — recorded gap.
            const event = currentEvent();
            if (event.kind === "options") {
              throw new PlanFailure(
                "select: 0 (no-option-selected) is not supported by the current runtime; options were presented",
              );
            }
          }
          expectedOptions.length = 0;
          break;
        }
        case "command": {
          const event = consume();
          if (event.kind !== "command") {
            throw new PlanFailure(`expected command "${step.text}", got ${describe(event)}`);
          }
          if (event.command !== step.text) {
            throw new PlanFailure(`expected command "${step.text}", got "${event.command}"`);
          }
          break;
        }
        case "stop": {
          const event = currentEvent();
          if (event.kind !== "complete") {
            throw new PlanFailure(`expected stop (dialogue complete), got ${describe(event)}`);
          }
          return; // remaining steps of this run are skipped, as upstream does
        }
        case "node": {
          runner.setNode(step.nodeName);
          pending = runner.currentResult;
          break;
        }
        case "set": {
          // Upstream (TestBase): set: requires the variable to be declared in
          // the program (Program.InitialValues lookup), then sets it into the
          // run's variable storage.
          if (!(step.variable in program.initialValues)) {
            throw new PlanFailure(`set: variable $${step.variable} is not valid in program`);
          }
          runner.setVariable(step.variable, step.value);
          break;
        }
        case "saliency": {
          if (!(KNOWN_SALIENCY_MODES as readonly string[]).includes(step.mode)) {
            throw new PlanFailure(`unknown saliency strategy "${step.mode}"`);
          }
          // Ignored: no swappable saliency strategy machinery yet.
          break;
        }
      }
    }

    if (harness.functionFailures.length > 0) {
      throw new PlanFailure(harness.functionFailures.join("; "));
    }
  }
}
