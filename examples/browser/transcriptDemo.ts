// SPDX-License-Identifier: CC0-1.0
// The shared transcript runner behind the Crossroads and Calibrations tabs:
// the vanilla runtime with no view layer — construct Dialogue from a
// plugin-compiled project, pull events with the package's pull API
// (`pullUntilStopped`), and render the story flow in delivery order (lines,
// commands, and the player's choices interleaved — the Try play view). A
// full state log (node, delivered events, stopping point, variable
// snapshot) accumulates alongside.
import { Dialogue, pullUntilStopped } from "yarnspinner-typescript";
import type {
  DialogueOption,
  MarkupAttribute,
  MarkupParseResult,
  StoppingPoint,
} from "yarnspinner-typescript";
import { el } from "./dom.js";

/** A plugin-compiled project module's default export. */
interface CompiledProject {
  program: TranscriptDemoProgram | null;
}
interface TranscriptDemoProgram {
  // Structural: the demo only hands it to Dialogue.
}

export interface TranscriptDemoOptions {
  /** The node to start from (default the runtime's default, "Start"). */
  startAt?: string;
}

/** The story flow, in delivery order. */
type FlowEntry =
  | { kind: "line"; speaker?: string; text: string; markup?: MarkupParseResult }
  | { kind: "command"; text: string }
  | { kind: "choice"; text: string };

/** How the demo presents markup attribute names: b/i are semantics, link is
 *  an anchor, anything else (wave, shake, …) renders its children plain —
 *  the Try site animates these; this demo does not. */
const MARKUP_TAGS: Record<string, string> = {
  b: "strong",
  i: "em",
  link: "a",
};

/** Render a parsed markup span into DOM nodes: children first, top-level
 *  attributes wrapped per MARKUP_TAGS, plain text between attributes.
 *  `exclude` carries the attributes already rendered at outer levels —
 *  recursion narrows by identity, never by range alone. */
function renderMarkupRange(
  markup: MarkupParseResult,
  start: number,
  end: number,
  exclude: MarkupAttribute[],
): Node[] {
  const nodes: Node[] = [];
  let cursor = start;
  // Top-level for this range: attributes starting inside it that are not
  // contained in another attribute also starting inside it.
  const attrs = markup.attributes
    .filter(
      (a) =>
        a.position >= start &&
        a.position + a.length <= end &&
        !exclude.includes(a) &&
        (a.name !== "character" || a.length > 0),
    )
    .sort((a, b) => a.position - b.position || b.length - a.length);
  const selected: MarkupAttribute[] = [];
  for (const a of attrs) {
    if (
      selected.some(
        (s) =>
          a.position >= s.position &&
          a.position + a.length <= s.position + s.length,
      )
    )
      continue;
    selected.push(a);
  }
  for (const a of selected) {
    if (a.position > cursor)
      nodes.push(
        document.createTextNode(markup.text.slice(cursor, a.position)),
      );
    const inner = renderMarkupRange(markup, a.position, a.position + a.length, [
      ...exclude,
      ...selected,
    ]);
    const tag = MARKUP_TAGS[a.name];
    if (tag === "a") {
      const href =
        a.properties["href"]?.stringValue ?? a.properties[a.name]?.stringValue;
      if (href) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.append(...inner);
        nodes.push(anchor);
      } else {
        nodes.push(...inner);
      }
    } else if (tag) {
      const node = document.createElement(tag);
      node.append(...inner);
      nodes.push(node);
    } else {
      nodes.push(...inner);
    }
    cursor = a.position + a.length;
  }
  if (cursor < end)
    nodes.push(document.createTextNode(markup.text.slice(cursor, end)));
  return nodes;
}

/** The raw `[link="url"]text[/link]` fallback: a line whose markup parse
 *  failed composes as raw text (parity with upstream — the implicit
 *  character-marker regex matches the colon inside the property value;
 *  see .scratch/markup-link-https/issues/01), so the demo renders the
 *  obvious intent itself. */
function renderLineContent(
  text: string,
  markup: MarkupParseResult | undefined,
): Node[] {
  if (markup) return renderMarkupRange(markup, 0, markup.text.length, []);
  const raw = /^\[link="([^"]+)"\]([\s\S]+?)\[\/link\]$/.exec(text);
  if (raw) {
    const anchor = document.createElement("a");
    anchor.href = raw[1];
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = raw[2];
    return [anchor];
  }
  return [document.createTextNode(text)];
}

export function mountTranscriptDemo(
  root: HTMLElement,
  compiled: CompiledProject,
  opts: TranscriptDemoOptions = {},
): void {
  if (!compiled.program) {
    throw new Error("the project compiled to no program");
  }
  const program = compiled.program;

  let dialogue: Dialogue;
  let flow: FlowEntry[] = [];
  let pendingOptions: DialogueOption[] | null = null;
  let stopped: StoppingPoint = "line";
  /** Every state transition, oldest first. */
  let log: string[] = [];

  const linesEl = el("div", "demo-lines");
  const controlsEl = el("div", "demo-controls");
  const logHeading = el("h2", undefined, "State log");
  const logEl = el("pre", "demo-log");
  root.append(linesEl, controlsEl, logHeading, logEl);

  /** Human-readable snapshot of every story variable, `$name = value`. */
  function variablesDump(): string {
    const vars = dialogue.getVariables();
    const names = Object.keys(vars);
    if (names.length === 0) return "(no variables)";
    return names
      .map((name) => `$${name} = ${JSON.stringify(vars[name])}`)
      .join(", ");
  }

  function note(entry: string): void {
    log.push(entry);
    logEl.textContent = log.join("\n\n");
  }

  function start(): void {
    dialogue = new Dialogue(program, { startAt: opts.startAt ?? "Start" });
    flow = [];
    pendingOptions = null;
    log = [];
    note(`start: node=${dialogue.currentNode} variables: ${variablesDump()}`);
    step();
  }

  function step(): void {
    const { events, stopped: at } = pullUntilStopped(dialogue);
    stopped = at;

    const parts: string[] = [`node=${dialogue.currentNode}`];
    for (const event of events) {
      if (event.type === "line") {
        flow.push({
          kind: "line",
          speaker: event.speaker,
          text: event.text,
          markup: event.markup,
        });
        parts.push(
          `line: ${event.speaker ? `${event.speaker}: ` : ""}${event.text}`,
        );
      } else if (event.type === "command") {
        flow.push({ kind: "command", text: event.command });
        parts.push(`command: ${event.command}`);
      } else if (event.type === "options") {
        pendingOptions = event.options;
        for (const option of event.options) {
          parts.push(
            `option [${option.index}]: ${option.text}${option.isAvailable ? "" : " (unavailable)"}`,
          );
        }
      }
    }
    parts.push(`stopped: ${stopped}`);
    parts.push(`variables: ${variablesDump()}`);
    note(parts.join("\n"));
    // The options event only arrives with an options stopping point, so any
    // other stop means any previous option set is spent — clear it, or the
    // stale buttons would stay up (suppressing Continue) and re-push old
    // choices on click.
    if (stopped !== "options") pendingOptions = null;
    render();
  }

  function select(index: number): void {
    const chosen = pendingOptions?.find((o) => o.index === index);
    if (!chosen) return;
    pendingOptions = null;
    flow.push({ kind: "choice", text: chosen.text });
    note(`select: [${chosen.index}] ${chosen.text}`);
    dialogue.selectOption(chosen.index);
    step();
  }

  function render(): void {
    linesEl.replaceChildren(
      ...flow.map((entry) => {
        if (entry.kind === "command")
          return el("p", "demo-command", entry.text);
        if (entry.kind === "choice")
          return el("p", "demo-choice", `→ ${entry.text}`);
        const p = el("p", "demo-line");
        if (entry.speaker)
          p.append(el("strong", "demo-speaker", entry.speaker));
        p.append(...renderLineContent(entry.text, entry.markup));
        return p;
      }),
    );

    const controls: HTMLElement[] = [];
    if (pendingOptions) {
      for (const option of pendingOptions) {
        const button = el(
          "button",
          "demo-option",
          option.text + (option.isAvailable ? "" : " (unavailable)"),
        );
        button.type = "button";
        button.addEventListener("click", () => select(option.index));
        controls.push(button);
      }
    } else {
      const complete = stopped === "complete";
      const button = el(
        "button",
        "demo-button",
        complete ? "Restart" : "Continue",
      );
      button.type = "button";
      button.addEventListener("click", complete ? start : step);
      controls.push(button);
    }
    controlsEl.replaceChildren(...controls);
  }

  start();
}
