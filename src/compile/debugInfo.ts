// SPDX-License-Identifier: CC0-1.0
/**
 * Debug output (upstream `YarnSpinner.Compiler.DebugInfo`): the compiled
 * project's per-node map from instruction index to the source range the
 * instruction came from — the seam content debuggers and language-server
 * tooling read (`NodeDebugInfo.GetLineInfo`, pinned upstream by
 * ProjectTests.TestDebugOutputIsProduced).
 *
 * Upstream records each instruction's source range during code generation
 * (every emit carries the ANTLR token's range). The port's lowering keeps
 * no per-instruction source positions, so this builder reconstructs the
 * mapping from the compiled program against the parsed documents:
 *
 * - `runLine` / `addOption` instructions carry their line's `line:` ID (the
 *   string-table pass writes every ID back into the AST), which resolves
 *   exactly to the line/option statement's source line;
 * - `addSaliencyCandidate` carries the candidate's line ID as its
 *   `contentId` — same exact resolution;
 * - `runCommand`/`stop`/`return`/`runNode`/`detour` instructions carry the
 *   authored command text verbatim (commands are single-line in this
 *   grammar), located in the node's source region in document order
 *   (emission order agrees with document order for these statements);
 * - instructions between two mapped anchors — the condition/once-state gate
 *   code in front of a line, option, or candidate — map to the following
 *   anchor's range (upstream attributes them to the same statement's
 *   tokens); instructions after the last mapped anchor stay unmapped.
 *
 * Unmapped instruction numbers throw from `getLineInfo` (upstream
 * `ArgumentOutOfRangeException`).
 */

import type { YarnDocument, YarnNode, Statement } from "../model/ast.js";
import { walkStatements } from "../model/walk.js";
import type { Program, ProgramNode } from "./program.js";

/** A 0-based source position (upstream `Yarn.Compiler.Position`). */
export interface DebugPosition {
  /** 0-based line. */
  line: number;
  /** 0-based character. */
  character: number;
}

/** A source range (upstream `Yarn.Compiler.Range`): inclusive start, exclusive end. */
export interface DebugRange {
  start: DebugPosition;
  end: DebugPosition;
}

/** Positional information about one instruction (upstream `NodeDebugInfo.LineInfo`). */
export interface LineInfo {
  /** The file the instruction was produced from. */
  fileName: string | undefined;
  /** The node the instruction was produced from. */
  nodeName: string;
  /** The range in `fileName` holding the statement this instruction came from. */
  range: DebugRange;
}

/** Debug information for one compiled node (upstream `NodeDebugInfo`). */
export class NodeDebugInfo {
  /** The file this debug info was produced from. */
  readonly fileName: string | undefined;
  /** The node this debug info was produced from. */
  nodeName: string;
  /** The range in the file in which the node appears. */
  range: DebugRange;
  /** Whether the node was created by the compiler (never here — file nodes only). */
  readonly isImplicit = false;

  /** Instruction index → source range (upstream `LineRanges`). */
  private readonly lineRanges = new Map<number, DebugRange>();

  constructor(fileName: string | undefined, nodeName: string, range: DebugRange) {
    this.fileName = fileName;
    this.nodeName = nodeName;
    this.range = range;
  }

  /** @internal */
  addRange(instructionIndex: number, range: DebugRange): void {
    this.lineRanges.set(instructionIndex, range);
  }

  /**
   * The position of the instruction at `instructionNumber`. Throws when the
   * instruction has no recorded range (upstream
   * `ArgumentOutOfRangeException`).
   */
  getLineInfo(instructionNumber: number): LineInfo {
    const range = this.lineRanges.get(instructionNumber);
    if (range === undefined) {
      throw new RangeError(
        `No debug info recorded for instruction ${instructionNumber} of node "${this.nodeName}"`,
      );
    }
    return { fileName: this.fileName, nodeName: this.nodeName, range };
  }
}

/** Debug information for a compiled project (upstream `ProjectDebugInfo`). */
export class ProjectDebugInfo {
  readonly nodes: NodeDebugInfo[] = [];

  /** The debug info for a node, if present. */
  getNodeDebugInfo(nodeName: string): NodeDebugInfo | undefined {
    return this.nodes.find((n) => n.nodeName === nodeName);
  }
}

/** One compilation input with its parsed document (upstream `CompilationJob.File` + its parse result). */
export interface DebugInfoInput {
  name: string;
  doc: YarnDocument;
  source: string;
}

/**
 * Build the debug info for a compiled program against its already-parsed
 * sources (the compile seam has the documents in hand; callers holding raw
 * sources parse them first — `parseYarn` is pure).
 */
export function buildProjectDebugInfo(
  inputs: DebugInfoInput[],
  program: Program | null,
): ProjectDebugInfo | null {
  if (program === null) return null;

  const debug = new ProjectDebugInfo();
  for (const input of inputs) {
    // A title shared by several nodes is a node group; the program stores
    // the group's members in document order (see the lowering's
    // groupNodesByTitle), so members match their AST nodes positionally.
    const memberCounters = new Map<string, number>();
    for (const node of input.doc.nodes) {
      const member = matchProgramNode(program, node, memberCounters);
      if (!member) continue;
      debug.nodes.push(buildNodeDebugInfo(input, node, member));
    }
  }
  return debug;
}

/**
 * Match an AST node to its compiled program node: single nodes map by
 * title; a node group's members map in document order.
 */
function matchProgramNode(
  program: Program,
  node: YarnNode,
  counters: Map<string, number>,
): ProgramNode | undefined {
  const entry = program.nodes[node.title];
  if (!entry) return undefined;
  if ("instructions" in entry) return entry;
  const index = counters.get(node.title) ?? 0;
  counters.set(node.title, index + 1);
  return entry.nodes[index];
}

function buildNodeDebugInfo(
  input: DebugInfoInput,
  node: YarnNode,
  member: ProgramNode,
): NodeDebugInfo {
  const locator = new NodeSourceLocator(input.source, node);
  const info = new NodeDebugInfo(node.sourceFile ?? input.name, member.title, locator.nodeRange());

  // Line-bearing statements keyed by their `line:` ID — the program's
  // runLine/addOption instructions carry the same ID (the string-table pass
  // writes every implicit ID back into the AST before lowering).
  const byLineId = new Map<string, DebugRange>();
  walkStatements(node.body, {
    onLine: (line) => {
      const id = line.tags?.find((t) => t.startsWith("line:"));
      if (id !== undefined && line.lineNumber !== undefined) {
        byLineId.set(id, locator.lineRange(line.lineNumber));
      }
    },
    onOption: (option) => {
      const id = option.tags?.find((t) => t.startsWith("line:"));
      if (id !== undefined && option.lineNumber !== undefined) {
        byLineId.set(id, locator.lineRange(option.lineNumber));
      }
    },
  });

  // Command/Jump/Detour statements carry no AST positions: locate each one
  // in the node's source region by its verbatim authored text, consumed in
  // document order (emission order agrees for these statements).
  const needles = new Map<string, number[]>(); // needle → source lines, document order
  walkStatements(node.body, {
    onStatement: (stmt) => {
      const needle = statementNeedle(stmt);
      if (needle === null) return;
      const line = locator.locate(needle);
      if (line !== undefined) {
        const list = needles.get(needle) ?? [];
        list.push(line);
        needles.set(needle, list);
      }
    },
  });
  const needleCursors = new Map<string, number>();
  const nextCommandLine = (needle: string): DebugRange | undefined => {
    const lines = needles.get(needle);
    const at = needleCursors.get(needle) ?? 0;
    if (lines === undefined || at >= lines.length) return undefined;
    needleCursors.set(needle, at + 1);
    return locator.wholeLineRange(lines[at]);
  };

  // Walk the instruction stream, anchoring on instructions whose statement
  // we can locate, and fill the span before each anchor with that anchor's
  // range (the gate bytecode in front of a line belongs to the line's
  // statement, as upstream's statement-scoped ranges do).
  const ranges = new Map<number, DebugRange>();
  let pendingStart = 0;
  const anchor = (index: number, range: DebugRange): void => {
    for (let i = pendingStart; i <= index; i++) {
      if (!ranges.has(i)) ranges.set(i, range);
    }
    pendingStart = index + 1;
  };

  member.instructions.forEach((instruction, index) => {
    let range: DebugRange | undefined;
    if (instruction.op === "runLine" || instruction.op === "addOption") {
      const id = instruction.tags?.find((t) => t.startsWith("line:"));
      if (id !== undefined) range = byLineId.get(id);
    } else if (instruction.op === "addSaliencyCandidate") {
      range = byLineId.get(instruction.contentId);
    } else if (instruction.op === "stop" || instruction.op === "return") {
      range = nextCommandLine(`<<${instruction.op}>>`);
    } else if (instruction.op === "runCommand") {
      range = nextCommandLine(`<<${instruction.content}>>`);
    } else if (instruction.op === "runNode") {
      range = nextCommandLine(`<<jump ${instruction.node}>>`);
    } else if (instruction.op === "detour") {
      range = nextCommandLine(`<<detour ${instruction.node}>>`);
    }
    if (range !== undefined) anchor(index, range);
  });

  for (const [index, range] of ranges) info.addRange(index, range);
  return info;
}

/**
 * The `<<...>>` text a Command/Jump/Detour statement is authored with
 * (commands are single-line and stored verbatim), used to find its source
 * line. Returns `null` for statements with no command text.
 */
function statementNeedle(stmt: Statement): string | null {
  switch (stmt.type) {
    case "Command":
      return `<<${stmt.content}>>`;
    case "Jump":
      return `<<jump ${stmt.target}>>`;
    case "Detour":
      return `<<detour ${stmt.target}>>`;
    default:
      return null;
  }
}

/**
 * Locates statements inside one node's source region and derives ranges
 * from the raw source lines (0-based positions, upstream's convention).
 */
class NodeSourceLocator {
  private readonly lines: string[];
  private readonly nodeStart: number; // 0-based, inclusive
  private readonly nodeEnd: number; // 0-based, inclusive
  private cursor: number;

  constructor(source: string, node: YarnNode) {
    this.lines = source.replace(/\r\n?/g, "\n").split("\n");
    this.nodeStart = Math.max((node.startLine ?? 1) - 1, 0);
    this.cursor = this.nodeStart;
    this.nodeEnd = this.findNodeEnd();
  }

  /** The node's range: first header line through the terminator line. */
  nodeRange(): DebugRange {
    return {
      start: { line: this.nodeStart, character: 0 },
      end: { line: this.nodeEnd, character: this.lines[this.nodeEnd]?.length ?? 0 },
    };
  }

  /** The range of the whole source line at `lineNumber` (1-based). */
  lineRange(lineNumber: number): DebugRange {
    return this.wholeLineRange(lineNumber - 1);
  }

  wholeLineRange(line: number): DebugRange {
    return {
      start: { line, character: 0 },
      end: { line, character: this.lines[line]?.length ?? 0 },
    };
  }

  /**
   * The 0-based line of the first occurrence of `needle` at or after the
   * locator's cursor (within the node's region), advancing the cursor.
   * Statements appear in source in document order, so one forward cursor
   * suffices per node.
   */
  locate(needle: string): number | undefined {
    for (let i = this.cursor; i <= this.nodeEnd; i++) {
      if (this.lines[i]?.includes(needle)) {
        this.cursor = i + 1;
        return i;
      }
    }
    return undefined;
  }

  private findNodeEnd(): number {
    for (let i = this.nodeStart; i < this.lines.length; i++) {
      const trimmed = this.lines[i]?.trim() ?? "";
      if (trimmed === "===" || trimmed.startsWith("===")) return i;
    }
    return Math.max(this.lines.length - 1, this.nodeStart);
  }
}
