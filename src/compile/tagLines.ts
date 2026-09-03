/**
 * tagLines — the line-tagging utility (spec ticket 51; upstream
 * `YarnSpinner.Compiler.Utility.TagLines` + `ILineTagGenerator`): parse a
 * `.yarn` source, find every user-visible line lacking a content-ID tag
 * (`#line:` or `#shadow:`), and append a generated `#line:` tag to each —
 * lines, line-group items, and shortcut options included.
 *
 * The generator is a pluggable seam (upstream `ILineTagGenerator`):
 * `prepareForLines(lineContexts, excludedIDs)` runs once with every node's
 * line contexts (line number, line text, existing ID), then
 * `generateLineTag(node, lineIndex)` produces each new ID — which must
 * start with `line:` and be unique against the known set (excluded IDs,
 * existing tags, and IDs generated this run). Two built-ins ship:
 *
 * - `RandomLineTagGenerator` (the default; upstream `RandomLineTagger`):
 *   `line:` + 7 lowercase hex chars. Upstream aborts on a 500 ms stopwatch;
 *   the library reads no clocks (coding standards §2), so the same
 *   exception fires after an attempt cap instead.
 * - `DescriptiveLineTagGenerator` (upstream `DescriptiveLineTagger`):
 *   `line:<node>_<NNNN>` — node's *unique* title (`Title.Subtitle` for
 *   node-group members with a subtitle, `Title.<crc32>` without), a 4-digit
 *   index numbered in 100s, midpoint insertions rounded to 5s, `_gN`
 *   generation suffixes when no gap remains, and the speaker's character
 *   name from the line's parsed `character` markup attribute.
 *
 * Tagging failures are data, not throws (coding standards §3): upstream's
 * `LineTaggingException` and internal `InvalidOperationException` demote to
 * returned exceptions carrying the upstream message texts, a ` // ERROR: …`
 * comment left at the offending line, and the `TagAbortBehaviour`
 * (`currentNode` default, `currentLine`, `entireTagging`) honored — a
 * failed node's tags are discarded, a failed tagging's tags never apply.
 * A file that fails to parse returns unchanged (upstream bails before
 * tagging).
 *
 * Adapted from YarnSpinner — see CITATION.cff.
 * Citation: Yarn Spinner Pty. Ltd., Secret Lab Pty. Ltd., and contributors —
 * YarnSpinner (v3.2.2) [MIT]
 * Source: https://github.com/YarnSpinnerTool/YarnSpinner/blob/v3.2.2/
 *   YarnSpinner.Compiler/Utility.cs and .../LineTaggers/
 * Accessed: 2026-09-03
 */

import { parseYarn, ParseError } from "../parse/parser.js";
import type { Line, Option, Statement, YarnDocument, YarnNode } from "../model/ast.js";
import { crc32Hex } from "./crc32.js";
import { LineParser } from "../markup/lineParser.js";
import { characterAttribute, characterAttributeNameProperty } from "../markup/lineParser.js";
import { tryGetProperty } from "../markup/types.js";

/** The generator seam (upstream `ILineTagGenerator`, context flattened). */
export interface LineTagGenerator {
  /**
   * Called once before any generation: every node's line contexts (in
   * document order — line number, line text, existing content-ID tag or
   * null) and the IDs that must not be generated.
   */
  prepareForLines(lineContexts: Record<string, LineTagContext[]>, excludedIDs: Set<string>): void;
  /** Generate a unique line ID for the node's line at `lineIndex`. */
  generateLineTag(node: string, lineIndex: number): string;
}

/** Per-line context handed to generators (upstream `LineTagContext`). */
export interface LineTagContext {
  /** 0-based source line number (upstream `LineNumber`). */
  lineNumber: number;
  /** The line's text (upstream `LineText`, via the formatted-text compose). */
  lineText: string;
  /** The line's existing `#line:`/`#shadow:` tag, or null. */
  lineId: string | null;
}

/** A tagging failure (upstream `ILineTagGenerator.LineTaggingException`) —
 *  returned as data, never thrown across the public API (coding standards §3). */
export class LineTaggingError extends Error {
  /** The file that caused the exception (upstream `SourceFile`). */
  sourceFile?: string;
  /** The 0-based line number that caused the exception (upstream `LineNumber`). */
  lineNumber: number;

  constructor(message: string, sourceFile?: string, lineNumber = -1) {
    super(message);
    this.sourceFile = sourceFile;
    this.lineNumber = lineNumber;
  }
}

/** Upstream `ILineTagGenerator.TagAbortBehaviour`. */
export type TagAbortBehaviour = "entireTagging" | "currentNode" | "currentLine";

export interface TagLinesOptions {
  /** The line-tag generator (default: {@link RandomLineTagGenerator}). */
  generator?: LineTagGenerator;
  /** Line IDs that must not be generated (upstream `excludedLineIDs`). */
  excludedLineIDs?: Iterable<string>;
  /** How tagging failures abort (upstream `TagAbortBehaviour`; default `currentNode`). */
  tagAbortBehaviour?: TagAbortBehaviour;
  /** The source file's name — error attribution and node-group unique titles. */
  fileName?: string;
}

export interface TagLinesResult {
  /** The source with generated tags (and any ` // ERROR: …` comments) applied. */
  modifiedSource: string;
  /** The full known-ID set: excluded IDs, existing tags, and generated IDs. */
  lineIds: string[];
  /** The tagging failures encountered (upstream returns `TagExceptions`). */
  tagExceptions: LineTaggingError[];
}

/**
 * Add line tags to every user-visible line of `source` that lacks one
 * (upstream `Utility.TagLines`).
 */
export function tagLines(source: string, opts: TagLinesOptions = {}): TagLinesResult {
  const fileName = opts.fileName ?? "<input>";

  // Parse the source. Any parse error bails before tagging: upstream isn't
  // confident it can insert a tag correctly, so the source returns unchanged.
  let doc: YarnDocument;
  try {
    doc = parseYarn(source);
  } catch (e) {
    if (e instanceof ParseError) {
      return { modifiedSource: source, lineIds: [], tagExceptions: [] };
    }
    throw e;
  }

  // Gather every node's line contexts (document order), keyed by the node's
  // unique title — the name the compiled program will use, so a node-group
  // member's descriptive tags read `Title.Subtitle_NNNN`.
  const lineContexts: Record<string, LineTagContext[]> = {};
  for (const node of doc.nodes) {
    const lines: LineTagContext[] = [];
    collectLines(node.body, lines);
    if (lines.length > 0) {
      lineContexts[uniqueNodeTitle(node, fileName)] = lines;
    }
  }

  const generator = opts.generator ?? new RandomLineTagGenerator();
  const tagExceptions: LineTaggingError[] = [];
  const knownLineIDs = new Set<string>(opts.excludedLineIDs ?? []);
  generator.prepareForLines(lineContexts, knownLineIDs);

  const behaviour = opts.tagAbortBehaviour ?? "currentNode";
  const sourceLines = source.split("\n");
  /** Applied tag rewrites: 1-based line number → generated tag. */
  const appliedTags = new Map<number, string>();
  const fullKnownIDs = new Set<string>(knownLineIDs);
  /** ` // ERROR: …` comments, 1-based line number → message. */
  const errorComments = new Map<number, string>();

  const addErrorComment = (lineNumber: number, message: string): void => {
    errorComments.set(lineNumber, message);
  };

  tagging: for (const [nodeTitle, lines] of Object.entries(lineContexts)) {
    const nodeKnownIDs = new Set<string>();
    const nodeTags = new Map<number, string>();

    for (let i = 0; i < lines.length; i++) {
      const context = lines[i];
      if (context.lineId !== null) continue;

      let newLineID: string;
      try {
        newLineID = generator.generateLineTag(nodeTitle, i);

        if (newLineID.trim() === "") {
          throw new LineTaggingError("Line ID generator returned a null or empty line ID");
        }
        if (fullKnownIDs.has(newLineID) || nodeKnownIDs.has(newLineID)) {
          throw new LineTaggingError(`Line ID generator returned a duplicate line tag ${newLineID}`);
        }
        if (!newLineID.startsWith("line:")) {
          throw new LineTaggingError(
            `Line IDs must start with #line: - line ID generator returned '${newLineID}'`,
          );
        }
      } catch (e) {
        // Upstream demotes nothing here — LineTaggingException takes the
        // abort-behaviour path below; other exceptions (its
        // InvalidOperationException guards) escape TagLines entirely. This
        // fork routes every failure through the same data path (§3).
        const error =
          e instanceof LineTaggingError
            ? e
            : new LineTaggingError(e instanceof Error ? e.message : String(e), fileName, context.lineNumber);
        if (error.sourceFile === undefined) {
          error.sourceFile = fileName;
          error.lineNumber = context.lineNumber;
        }
        tagExceptions.push(error);
        addErrorComment(context.lineNumber, error.message);

        if (behaviour === "currentLine") continue;
        if (behaviour === "currentNode") continue tagging;
        break tagging;
      }

      nodeKnownIDs.add(newLineID);
      nodeTags.set(context.lineNumber, newLineID);
    }

    // The node completed: its tags join the applied set (upstream unions
    // per-node rewrites only after the node survives).
    for (const [lineNumber, tag] of nodeTags) appliedTags.set(lineNumber, tag);
    for (const id of nodeKnownIDs) fullKnownIDs.add(id);
  }

  // Apply the rewrites: each tag inserts after the line's content (upstream
  // inserts ` #tag ` after the last token on the default channel); each
  // error comment inserts before the line's end. Existing trailing
  // whitespace is preserved.
  for (const [lineNumber, tag] of appliedTags) {
    sourceLines[lineNumber] = sourceLines[lineNumber].replace(/(\s*)$/, ` #${tag} $1`);
  }
  for (const [lineNumber, message] of errorComments) {
    sourceLines[lineNumber] = sourceLines[lineNumber].replace(/(\s*)$/, ` // ERROR: ${message}$1`);
  }

  return {
    modifiedSource: sourceLines.join("\n"),
    lineIds: [...fullKnownIDs],
    tagExceptions,
  };
}

/**
 * The node's unique title (upstream `Utility.TryGetNodeTitle` +
 * `GetNodeUniqueName`): the plain `title:` header, or — for node-group
 * members (`when:` headers) — `Title.Subtitle` with an explicit subtitle,
 * else `Title.<crc32(fileName + title + startLine)>`.
 */
function uniqueNodeTitle(node: YarnNode, fileName: string): string {
  if (!node.when || node.when.length === 0) return node.title;
  const subtitle = node.headers["subtitle"]?.trim();
  if (subtitle) return `${node.title}.${subtitle}`;
  // Upstream seeds the checksum with the node's first source line.
  const startLine = node.startLine ?? firstBodyLine(node) ?? 0;
  return `${node.title}.${crc32Hex(`${fileName}${node.title}${startLine}`)}`;
}

function firstBodyLine(node: YarnNode): number | undefined {
  for (const stmt of node.body) {
    if (stmt.type === "Line") return stmt.lineNumber;
  }
  return undefined;
}


/** Every line-bearing statement of a statement list, document order. */
function collectLines(stmts: Statement[], out: LineTagContext[]): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Line":
        out.push(lineContext(s));
        break;
      case "LineGroup":
        for (const item of s.items) out.push(lineContext(item));
        break;
      case "OptionGroup":
        for (const option of s.options) {
          out.push(lineContext(option));
          collectLines(option.body, out);
        }
        break;
      case "If":
        for (const b of s.branches) collectLines(b.body, out);
        break;
      case "Once":
        collectLines(s.body, out);
        if (s.elseBody) collectLines(s.elseBody, out);
        break;
      case "Command":
      case "Jump":
      case "Detour":
      case "Enum":
        break;
    }
  }
}

function lineContext(line: Line | Option): LineTagContext {
  const tags = line.tags ?? [];
  // A `#shadow:` tag counts as an existing ID: shadow lines are not tagged
  // (upstream records either tag as the line's LineID).
  const existing =
    tags.find((t) => t.startsWith("line:")) ?? tags.find((t) => t.startsWith("shadow:")) ?? null;
  return {
    lineNumber: (line.lineNumber ?? 1) - 1,
    lineText: line.text,
    lineId: existing,
  };
}

/**
 * A line tag generator that produces line IDs containing a random
 * 7-character hexadecimal string (upstream `RandomLineTagGenerator` — the
 * default generator).
 */
export class RandomLineTagGenerator implements LineTagGenerator {
  private allKeys: Set<string> | null = null;

  prepareForLines(lineContexts: Record<string, LineTagContext[]>, excludedIDs: Set<string>): void {
    this.allKeys = new Set(excludedIDs);
    for (const lines of Object.values(lineContexts)) {
      for (const line of lines) {
        if (line.lineId !== null) this.allKeys.add(line.lineId);
      }
    }
  }

  generateLineTag(): string {
    if (this.allKeys === null) {
      throw new LineTaggingError("Asked to generate a line tag but haven't been given the context");
    }
    // Upstream caps the search at 500 ms (a wall clock — unavailable to the
    // library, coding standards §2); the same exception fires after an
    // attempt cap. The 2^28 space makes hitting it vanishingly unlikely.
    const maxAttempts = 1000;
    let attempt = 0;
    let tag: string;
    do {
      if (attempt >= maxAttempts) {
        throw new LineTaggingError("Unable to tag the line due to running out of time.");
      }
      tag = `line:${Math.floor(Math.random() * 0x1000000).toString(16).padStart(7, "0")}`;
      attempt += 1;
    } while (this.allKeys.has(tag));
    this.allKeys.add(tag);
    return tag;
  }
}

const INDEX_MULTIPLIER = 100;
const ROUND_FACTOR = 5;

/**
 * A line tag generator that produces IDs approximating how a person would
 * manually tag lines (upstream `DescriptiveLineTagGenerator`):
 * `line:<node>_<NNNN>[_gN][_<CharacterName>]`.
 */
export class DescriptiveLineTagGenerator implements LineTagGenerator {
  private lineContexts: Record<string, LineTagContext[]> | null = null;
  private readonly generations = new Map<string, Map<number, number>>();
  private readonly numbers = new Map<string, number[]>();
  private readonly exclusions = new Set<string>();
  private readonly lineParser = new LineParser();

  prepareForLines(lineContexts: Record<string, LineTagContext[]>, excludedIDs: Set<string>): void {
    this.lineContexts = lineContexts;
    this.numbers.clear();
    for (const id of excludedIDs) this.exclusions.add(id);

    for (const [node, lines] of Object.entries(lineContexts)) {
      const elements = new Array<number>(lines.length);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let num = -1;
        let generation = 0;

        if (line.lineId !== null && line.lineId.trim() !== "") {
          for (const piece of line.lineId.split("_")) {
            if (/^[0-9]+$/.test(piece)) {
              num = parseInt(piece, 10);
            } else if (/^g[0-9]+$/.test(piece)) {
              generation = parseInt(piece.slice(1), 10);
            }
          }
        }

        if (num !== -1) {
          let genCollection = this.generations.get(node);
          if (!genCollection) {
            genCollection = new Map<number, number>();
            this.generations.set(node, genCollection);
          }
          const current = genCollection.get(num);
          if (current === undefined || generation > current) {
            genCollection.set(num, generation);
          }
        }
        elements[i] = num;
      }
      this.numbers.set(node, elements);
    }
  }

  generateLineTag(node: string, lineIndex: number): string {
    if (this.lineContexts === null) {
      throw new LineTaggingError(
        `Asked to generate a line at index ${lineIndex} for ${node} node but we haven't been given a context`,
      );
    }
    const linesForNode = this.lineContexts[node];
    if (!linesForNode) {
      throw new LineTaggingError(
        `Asked to generate a line at index ${lineIndex} for ${node} node but we have no node with this name`,
      );
    }
    if (linesForNode.length === 0) {
      throw new LineTaggingError(
        `Asked to generate a line at index ${lineIndex} for ${node} node but this list is empty`,
      );
    }
    if (lineIndex < 0 || lineIndex >= linesForNode.length) {
      throw new LineTaggingError(
        `Asked to generate a line at index ${lineIndex} for ${node} node but the index is out of bounds`,
      );
    }
    const context = linesForNode[lineIndex];
    const parsedNumbers = this.numbers.get(node);
    if (!parsedNumbers) {
      throw new LineTaggingError("Asked to generate a line tag but haven't been given the context");
    }

    const parsedMarkup = this.parseLineText(context.lineText);

    const lineIDComponents: string[] = [node];

    const neighbours = getNeighbours(lineIndex, parsedNumbers);

    let increment: number;
    let finalIndex: number;
    if (neighbours.leftCount === -1 && neighbours.rightCount === -1) {
      // No tagged lines anywhere: number by line index (upstream's ideal case).
      finalIndex = (lineIndex + 1) * INDEX_MULTIPLIER;
      increment = INDEX_MULTIPLIER;
    } else if (neighbours.leftCount !== -1 && neighbours.rightCount !== -1) {
      // Between two tagged lines (an insertion). A descending range cannot
      // be linearly spaced — upstream raises.
      if (neighbours.leftCount > neighbours.rightCount) {
        throw new LineTaggingError(
          `The preceeding dialogue has a greater tagged value (${neighbours.leftCount}) than the following (${neighbours.rightCount}).`,
          undefined,
          context.lineNumber,
        );
      }
      const diff = neighbours.rightCount - neighbours.leftCount;
      const insertions = neighbours.rightIndex - 1 - neighbours.leftIndex;
      increment = Math.floor(diff / (insertions + 1));
      const relativeIndex = lineIndex - neighbours.leftIndex;
      if (increment > 0) {
        finalIndex = neighbours.leftCount + relativeIndex * increment;
      } else {
        // Not enough space: dense packing (which forces generational numbers).
        increment = 1;
        finalIndex = Math.min(neighbours.leftCount + relativeIndex, neighbours.rightCount);
      }
    } else if (neighbours.leftIndex === -1) {
      // A rightmost neighbour only: inserted before any tagged lines.
      increment = Math.floor(neighbours.rightCount / (neighbours.rightIndex + 1));
      if (increment > 0) {
        finalIndex = increment * (1 + lineIndex);
      } else {
        increment = 1;
        finalIndex = Math.min(increment * lineIndex, neighbours.rightCount);
      }
    } else {
      // A leftmost neighbour only: inserted after any tagged lines — continue
      // numbering from the next multiple of the index multiplier.
      const nextMultiple =
        neighbours.leftCount + INDEX_MULTIPLIER - 1 - ((neighbours.leftCount + INDEX_MULTIPLIER - 1) % INDEX_MULTIPLIER);
      increment = INDEX_MULTIPLIER;
      finalIndex = (lineIndex - neighbours.leftIndex) * INDEX_MULTIPLIER + nextMultiple;
    }

    // Round up to the nearest five (neater numbers) when there's space.
    if (increment > ROUND_FACTOR) {
      finalIndex = finalIndex + ROUND_FACTOR - 1 - ((finalIndex + ROUND_FACTOR - 1) % ROUND_FACTOR);
    }

    lineIDComponents.push(String(finalIndex).padStart(4, "0"));

    const generation = this.getGeneration(node, finalIndex);
    if (generation !== 0) {
      lineIDComponents.push(`g${generation}`);
    }

    const character = parsedMarkup?.attributes.find((a) => a.name === characterAttribute);
    const name = character ? tryGetProperty(character, characterAttributeNameProperty) : undefined;
    if (name && name.type === "string") {
      lineIDComponents.push(name.stringValue);
    }

    const id = `line:${lineIDComponents.join("_")}`;

    if (this.exclusions.has(id)) {
      throw new LineTaggingError(
        `The generated id '${id}' conflicts with an id we were excluded from using.`,
        undefined,
        context.lineNumber,
      );
    }

    return id;
  }

  /**
   * The line text parsed for the `character` attribute (upstream parses
   * with the invariant culture's two-letter language name); a failed parse
   * contributes no attribute.
   */
  private parseLineText(lineText: string) {
    try {
      return this.lineParser.parseString(lineText, "en");
    } catch {
      return undefined;
    }
  }

  private getGeneration(node: string, number: number): number {
    let numbers = this.generations.get(node);
    if (!numbers) {
      numbers = new Map<number, number>([[number, 0]]);
      this.generations.set(node, numbers);
      return 0;
    }
    const generation = numbers.get(number);
    if (generation !== undefined) {
      numbers.set(number, generation + 1);
      return generation + 1;
    }
    numbers.set(number, 0);
    return 0;
  }
}

/** Upstream `GetNeighbours`: the nearest tagged lines on either side. */
function getNeighbours(
  lineIndex: number,
  numbers: number[],
): { leftCount: number; leftIndex: number; rightCount: number; rightIndex: number } {
  let lc = -1, li = -1, rc = -1, ri = -1;
  for (let i = lineIndex + 1; i < numbers.length; i++) {
    if (numbers[i] === -1) continue;
    ri = i;
    rc = numbers[i];
    break;
  }
  for (let i = lineIndex - 1; i > -1; i--) {
    if (numbers[i] === -1) continue;
    li = i;
    lc = numbers[i];
    break;
  }
  return { leftCount: lc, leftIndex: li, rightCount: rc, rightIndex: ri };
}
