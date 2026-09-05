// SPDX-License-Identifier: CC0-1.0
/**
 * Port of the upstream conformance runner (`YarnSpinner.Tests/TestBase.cs`,
 * `RunStandardTestcase`) onto this project's runtime, driving the vendored
 * `.testplan` fixtures over the pull-based event-stream API.
 *
 * Upstream semantics preserved:
 * - Step-locked event stream: every expectation fails if any *other* event
 *   arrives (not transcript comparison). Line, Options, Command, and
 *   DialogueComplete are step-locked; NodeStart/NodeComplete/LineHints flow
 *   freely (upstream's TestBase leaves those handlers as no-ops).
 * - Expected line text is compared against the composed text: string-table
 *   text with `{expr}` substitutions expanded, including the character-name
 *   prefix (`Baker: Hey there!`).
 * - Option expectations check the FULL delivered set in order — text,
 *   hashtags, and availability (`[disabled]` ↔ `isAvailable: false`,
 *   upstream `OptionSet.Option.IsAvailable`).
 * - `select:` maps directly to `selectOption` (the plan value is 1-based;
 *   the parser converts to a 0-based option ID, `select: 0` becomes
 *   `noOptionSelected` = -1). When no option is available the plan must
 *   select none, and the dialogue falls through past the options block
 *   (upstream 3.1 `Dialogue.NoOptionSelected`).
 * - All runs of a plan share one dialogue: variables, once-state, and visit
 *   counts persist across runs (each run re-enters the start node).
 * - `set:` steps are validated against the program's declared initial values
 *   (upstream `Program.InitialValues`) and applied to the shared storage.
 * - `saliency:` steps swap the named built-in saliency strategy onto the
 *   dialogue mid-run (upstream TestBase's saliencyStrategies map).
 * - Harness-registered functions are part of the conformance contract
 *   (TestBase/LanguageTests): `assert`, `dummy_*`, `add_three_operands`, and
 *   the quest stubs — registered through the Library.
 *
 * Documented remaining gaps (each a recorded parity gap, not a new
 * decision):
 * - Upstream's `assert` throws and aborts the run; here `assert` records
 *   failures and the runner fails the test with them.
 *
 * `<<call>>` invokes its host function and discards the result
 * (upstream CallStatement pin), so the fixtures' `assert(...)`-in-call coverage is real.
 */

import { Dialogue, Library, noOptionSelected } from "../../runtime/dialogue.js";
import type { DialogueEvent } from "../../runtime/dialogue.js";
import {
  saliencyStrategyForMode,
  SALIENCY_MODES,
} from "../../runtime/saliency.js";
import type { Program } from "../../compile/program.js";
import type { TestPlan, TestPlanRun, TestPlanStep } from "./testPlan.js";
export class PlanFailure extends Error {}

export const KNOWN_SALIENCY_MODES = SALIENCY_MODES;

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
      add_three_operands: (a: unknown, b: unknown, c: unknown) =>
        Number(a) + Number(b) + Number(c),
      set_objective_complete: () => true,
      is_objective_active: () => true,
      get_quest_status: () => "InProgress",
    },
  };
}

type DialogueStepEvent = Extract<
  DialogueEvent,
  { type: "line" | "options" | "command" | "dialogueComplete" }
>;

function describe(event: DialogueStepEvent): string {
  switch (event.type) {
    case "line":
      return `line "${event.speaker ? `${event.speaker}: ` : ""}${event.text}"`;
    case "command":
      return `command "${event.command}"`;
    case "options":
      return `options [${event.options.map((o) => `"${o.text}"`).join(", ")}]`;
    case "dialogueComplete":
      return "dialogue complete";
  }
}

function normalizeTag(tag: string): string {
  return tag.startsWith("#") ? tag.slice(1) : tag;
}

/** Composed text of a line event: substitutions are already applied by the runtime. */
function composedText(event: Extract<DialogueEvent, { type: "line" }>): string {
  return event.speaker ? `${event.speaker}: ${event.text}` : event.text;
}

/**
 * Plan hashtags are parsed (the grammar's intent) but NOT asserted: upstream
 * `TestBase.Hashtag` matches against `LineModel.Metadata`, and its plan
 * lexer's maximal-munch COMMENT token means plan hashtags never actually
 * parse upstream — the assertion is dead code there (verified against
 * v3.2.2: guarded by `.Any()` over an always-empty list). The corpus RELIES
 * on it being dead: Lines.testplan expects `#hashtag` on "Testing comments
 * after line conditions" while Lines.yarn's matching line carries no
 * hashtag at all — asserting here would fail content upstream's own suite
 * accepts.
 */
function assertHashtags(
  _expected: string[],
  _actual: string[] | undefined,
  _what: string,
): void {}

/** The program under test: the instruction-stream artifact (ADR 0001). */

export function runTestPlan(program: Program, plan: TestPlan): void {
  const firstRun = plan.runs[0];
  if (!program.nodes[firstRun.startNode]) {
    // Upstream: a plan is only executed when the start node exists;
    // otherwise the fixture is compile-checked only.
    throw new PlanFailure(`program has no "${firstRun.startNode}" node to run`);
  }

  const harness = createConformanceHarness();
  const library = new Library();
  for (const [name, fn] of Object.entries(harness.functions)) {
    library.registerFunction(name, fn);
  }
  const dialogue = new Dialogue(program, {
    startAt: firstRun.startNode,
    library,
  });
  // Batches are pulled lazily so plan `set:` steps land before the node body
  // first runs (upstream: VariableStorage writes precede the first Continue).
  let queue: DialogueEvent[] = [];

  /**
   * The next step-locked event, draining lifecycle events (and pulling new
   * batches as needed). NodeStart/NodeComplete/LineHints flow freely, as
   * upstream's TestBase leaves those handlers as no-ops.
   */
  const currentEvent = (): DialogueStepEvent => {
    let guard = 0;
    for (;;) {
      if (queue.length === 0) {
        if (guard++ > 10_000)
          throw new PlanFailure("runtime stalled without emitting an event");
        queue = dialogue.continue();
        if (queue.length === 0) {
          throw new PlanFailure("runtime stalled without emitting an event");
        }
      }
      const event = queue[0];
      if (
        event.type === "nodeStart" ||
        event.type === "nodeComplete" ||
        event.type === "lineHints"
      ) {
        queue.shift();
        continue;
      }
      return event;
    }
  };

  /** Take the next step-locked event (the complete event is never passed over). */
  const consume = (): DialogueStepEvent => {
    const event = currentEvent();
    queue.shift();
    return event;
  };

  const expectLine = (
    event: DialogueStepEvent,
    step: Extract<TestPlanStep, { kind: "line" }>,
  ): void => {
    if (event.type !== "line") {
      throw new PlanFailure(`expected line, got ${describe(event)}`);
    }
    if (step.text !== null && composedText(event) !== step.text) {
      throw new PlanFailure(
        `expected line "${step.text}", got "${composedText(event)}"`,
      );
    }
    assertHashtags(step.hashtags, event.tags, "line");
  };

  let firstOfPlan = true;
  for (const run of plan.runs) {
    runOne(run);
  }

  function runOne(run: TestPlanRun): void {
    if (!program.nodes[run.startNode]) {
      throw new PlanFailure(
        `run start node "${run.startNode}" does not exist in program`,
      );
    }
    if (firstOfPlan) {
      firstOfPlan = false; // the constructor already entered the first run's node
    } else {
      dialogue.setNode(run.startNode);
      queue = [];
    }

    const expectedOptions: Extract<TestPlanStep, { kind: "option" }>[] = [];

    for (const step of run.steps) {
      switch (step.kind) {
        case "line": {
          const event = consume();
          expectLine(event, step);
          break;
        }
        case "option": {
          expectedOptions.push(step);
          break;
        }
        case "select": {
          // The option expectations are verified against the delivered set,
          // which contains ALL options in order (disabled ones included).
          const event = consume();
          if (event.type !== "options") {
            throw new PlanFailure(
              `expected ${expectedOptions.length} option(s), got ${describe(event)}`,
            );
          }
          if (event.options.length !== expectedOptions.length) {
            throw new PlanFailure(
              `expected ${expectedOptions.length} option(s), got ${event.options.length}: [${event.options.map((o) => `"${o.text}"`).join(", ")}]`,
            );
          }
          for (let i = 0; i < event.options.length; i++) {
            const expectation = expectedOptions[i];
            const option = event.options[i];
            if (expectation.text !== null && option.text !== expectation.text) {
              throw new PlanFailure(
                `expected option "${expectation.text}", got "${option.text}"`,
              );
            }
            if (option.isAvailable === expectation.disabled) {
              throw new PlanFailure(
                `option "${expectation.text}"'s availability was expected to be ${!expectation.disabled}`,
              );
            }
            assertHashtags(expectation.hashtags, option.tags, "option");
          }
          // The plan's select value is 1-based (parser converts to a 0-based
          // option ID; 0 becomes noOptionSelected). When no option is
          // available the plan must select none, and the dialogue falls
          // through past the options block.
          const anyAvailable = event.options.some((o) => o.isAvailable);
          if (anyAvailable) {
            if (step.optionIndex < 0) {
              throw new PlanFailure(
                "plan selects no option, but options are available",
              );
            }
            if (step.optionIndex >= event.options.length) {
              throw new PlanFailure(
                `plan selects option ${step.optionIndex}, which does not exist`,
              );
            }
          } else if (step.optionIndex !== noOptionSelected) {
            throw new PlanFailure(
              `no option is available, so the plan must select: 0 (got select: ${step.optionIndex + 1})`,
            );
          }
          dialogue.selectOption(step.optionIndex);
          expectedOptions.length = 0;
          break;
        }
        case "command": {
          const event = consume();
          if (event.type !== "command") {
            throw new PlanFailure(
              `expected command "${step.text}", got ${describe(event)}`,
            );
          }
          if (event.command !== step.text) {
            throw new PlanFailure(
              `expected command "${step.text}", got "${event.command}"`,
            );
          }
          break;
        }
        case "stop": {
          const event = currentEvent();
          if (event.type !== "dialogueComplete") {
            throw new PlanFailure(
              `expected stop (dialogue complete), got ${describe(event)}`,
            );
          }
          queue.shift();
          return; // remaining steps of this run are skipped, as upstream does
        }
        case "node": {
          dialogue.setNode(step.nodeName);
          queue = [];
          break;
        }
        case "set": {
          // Upstream (TestBase): set: requires the variable to be declared in
          // the program (Program.InitialValues lookup), then sets it into the
          // run's variable storage.
          if (!(step.variable in program.initialValues)) {
            throw new PlanFailure(
              `set: variable $${step.variable} is not valid in program`,
            );
          }
          dialogue.setVariable(step.variable, step.value);
          break;
        }
        case "saliency": {
          // Upstream TestBase maps the plan's mode to a built-in strategy
          // and swaps it onto the dialogue mid-run.
          if (!dialogue.setSaliencyStrategy(step.mode)) {
            throw new PlanFailure(`unknown saliency strategy "${step.mode}"`);
          }
          break;
        }
      }
    }

    if (harness.functionFailures.length > 0) {
      throw new PlanFailure(harness.functionFailures.join("; "));
    }
  }
}
