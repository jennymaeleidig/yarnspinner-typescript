// SPDX-License-Identifier: CC0-1.0
/**
 * The language-upgrader surface (upstream
 * `YarnSpinner.Compiler.Upgrader.LanguageUpgrader`): a replacement list
 * describing how to move original source text to upgraded text, applied
 * against the original text to produce the upgraded result.
 *
 * Parity note (coding standards §1): upstream 3.2.2 has REMOVED the v1→v2
 * language upgrader (upstream CHANGELOG 2.4.1; `UpgraderTests
 * .TestUpgradingFiles` is skipped upstream and the `Tests/Upgrader/`
 * fixtures no longer exist). `LanguageUpgrader.Upgrade` in 3.2.2 has only
 * its `default` branch — it throws "Upgrade type {type} is not supported."
 * for every upgrade type — and this port matches that, exactly as upstream
 * does. What survives upstream (and is ported here) is the replacement
 * machinery: `TextReplacement`, `applyReplacements`, and the
 * `UpgradeJob`/`UpgradeResult`/`OutputFile` shapes.
 *
 * Replacement application throws (upstream `ArgumentOutOfRangeException`)
 * when a replacement starts past the text's length or the expected
 * original text is not found — a programmer-error guard on the API, named
 * and self-describing (the `transcript.ts` bounded-guard precedent).
 */

// Citation: Yarn Spinner Pty Ltd, Secret Lab Pty Ltd, and Yarn Spinner
// contributors — YarnSpinner (v3.2.2, commit 5b3a4ff2d24e4f727e3f90fee5d8ce637474c305) [MIT]
// Source: https://github.com/YarnSpinnerTool/YarnSpinner — YarnSpinner.Compiler/Upgrader/LanguageUpgrader.cs
//         (LanguageUpgrader.Upgrade, LanguageUpgrader.ApplyReplacements,
//         UpgradeJob, UpgradeResult, OutputFile, TextReplacement)
// Accessed: 2026-09-05
// Modified by yarn-spinner-runner-ts on 2026-09-05 — ported to TypeScript
// (camelCase surface; ArgumentOutOfRangeException → RangeError; the
// LINQ-based ordering becomes stable sorts with the same keys).

import type { Diagnostic } from "./diagnostics.js";

/** One input of an upgrade job (upstream `CompilationJob.File`). */
export interface UpgradeFile {
  /** The file's name (its path in the upgrade job). */
  name: string;
  source: string;
}

/**
 * What kind of language upgrading should be applied (upstream
 * `Yarn.Compiler.Upgrader.UpgradeType`). Upstream 3.2.2 defines only
 * `Version1to2` — and no upgrader implements it.
 */
export type UpgradeType = "Version1to2";

/** An upgrade job (upstream `Yarn.Compiler.Upgrader.UpgradeJob`). */
export interface UpgradeJob {
  /** The type of the upgrade to perform. */
  upgradeType: UpgradeType;
  /** The files to upgrade. */
  files: UpgradeFile[];
}

/** Contains information describing a replacement to make in a string (upstream `TextReplacement`). */
export interface TextReplacement {
  /**
   * The position in the original string where the substitution should be
   * made.
   */
  start: number;
  /** The line in the original string where the substitution should be made. */
  startLine?: number;
  /** The string to expect at `start` in the original string. */
  originalText: string;
  /** The string to replace `originalText` with at `start`. */
  replacementText: string;
  /** A descriptive comment explaining why the substitution is necessary. */
  comment?: string;
}

/**
 * A file generated as part of an upgrade (upstream
 * `UpgradeResult.OutputFile`): the original source plus the replacements
 * that produce the upgraded source from it.
 */
export interface UpgradeOutputFile {
  /** The path of the file. */
  path: string;
  /**
   * The replacements needed to go from `originalSource` to
   * `upgradedSource`.
   */
  replacements: TextReplacement[];
  /** The original text of the file, prior to upgrades. */
  originalSource: string;
  /** The diagnostics produced for this file by the upgrade process. */
  diagnostics: Diagnostic[];
  /**
   * True when this output file represents a new file to be created (its
   * original source is empty and its replacements are empty).
   */
  isNewFile: boolean;
  /** The upgraded text: `originalSource` with all replacements applied. */
  readonly upgradedSource: string;
}

/**
 * Creates an output file for a file that existed before the upgrade
 * (upstream `OutputFile(path, replacements, originalSource)`). The
 * upgraded source is computed lazily by applying the replacements.
 */
export function existingOutputFile(
  path: string,
  replacements: TextReplacement[],
  originalSource: string,
  diagnostics: Diagnostic[] = [],
): UpgradeOutputFile {
  return {
    path,
    replacements,
    originalSource,
    diagnostics,
    isNewFile: false,
    get upgradedSource(): string {
      return applyReplacements(originalSource, replacements);
    },
  };
}

/**
 * Creates an output file representing a new file to be created (upstream
 * `OutputFile(path, newContent)`): its source is the new content, with no
 * replacements.
 */
export function newOutputFile(
  path: string,
  newContent: string,
  diagnostics: Diagnostic[] = [],
): UpgradeOutputFile {
  return {
    path,
    replacements: [],
    originalSource: newContent,
    diagnostics,
    isNewFile: true,
    get upgradedSource(): string {
      return newContent;
    },
  };
}

/**
 * The result of an upgrade (upstream `UpgradeResult`): the files produced.
 */
export interface UpgradeResult {
  /** The files produced as part of the upgrade. */
  files: UpgradeOutputFile[];
}

/** All diagnostics across the upgrade result's files (upstream `UpgradeResult.Diagnostics`). */
export function upgradeDiagnostics(result: UpgradeResult): Diagnostic[] {
  return result.files.flatMap((f) => f.diagnostics);
}

/**
 * Merges two output files with the same path and original source, combining
 * their replacements sorted by start line then start (upstream
 * `OutputFile.Merge`).
 */
export function mergeOutputFiles(
  a: UpgradeOutputFile,
  b: UpgradeOutputFile,
): UpgradeOutputFile {
  if (a.path !== b.path) {
    throw new Error(`Cannot merge ${a.path} and ${b.path}: path fields differ`);
  }
  if (a.originalSource !== b.originalSource) {
    throw new Error(
      `Cannot merge ${a.path} and ${b.path}: originalSource fields differ`,
    );
  }
  if (a.isNewFile || b.isNewFile) {
    throw new Error(
      `Cannot merge ${a.path} and ${b.path}: one or both of them are new files`,
    );
  }
  const mergedReplacements = [...a.replacements, ...b.replacements].sort(
    (r1, r2) =>
      (r1.startLine ?? 0) - (r2.startLine ?? 0) || r1.start - r2.start,
  );
  return existingOutputFile(a.path, mergedReplacements, a.originalSource);
}

/**
 * Merges two upgrade results by joining their files on path (upstream
 * `UpgradeResult.Merge`): file pairs merge, unmatched files from both
 * sides pass through.
 */
export function mergeUpgradeResults(
  a: UpgradeResult,
  b: UpgradeResult,
): UpgradeResult {
  const aPaths = new Set(a.files.map((f) => f.path));
  const bPaths = new Set(b.files.map((f) => f.path));
  const onlyA = a.files.filter((f) => !bPaths.has(f.path));
  const onlyB = b.files.filter((f) => !aPaths.has(f.path));
  const merged = a.files
    .filter((fa) => bPaths.has(fa.path))
    .map((fa) =>
      mergeOutputFiles(
        fa,
        b.files.find((fb) => fb.path === fa.path)!,
      ),
    );
  return { files: [...onlyA, ...onlyB, ...merged] };
}

/**
 * The upgrader entry point (upstream `LanguageUpgrader.Upgrade`).
 *
 * Upstream 3.2.2 implements no upgraders: every upgrade type falls through
 * to the "not supported" error (the v1→v2 upgrader was removed in upstream
 * 2.4.1). This port matches that — parity is the spec; a v1→v2 transform
 * re-invented here would have no upstream behavioral spec to pin against.
 */
export const languageUpgrader = {
  upgrade(job: UpgradeJob): UpgradeResult {
    // Upstream 3.2.2's switch has only its default branch: every upgrade
    // type is unsupported (its ArgumentException message, verbatim).
    throw new Error(`Upgrade type ${job.upgradeType} is not supported.`);
  },

  /**
   * Applies a collection of string replacements to a string (upstream
   * `LanguageUpgrader.ApplyReplacements`).
   */
  applyReplacements(
    originalText: string,
    replacements: Iterable<TextReplacement>,
  ): string {
    return applyReplacements(originalText, replacements);
  },
};

/**
 * `LanguageUpgrader.ApplyReplacements`, verbatim in behavior: sort by start,
 * apply with a running offset, and throw when a replacement refers to an
 * invalid position or its original text does not match.
 */
export function applyReplacements(
  originalText: string,
  replacements: Iterable<TextReplacement>,
): string {
  // We need this in order of start position because replacements are very
  // likely to change the length of the string, which throws off our start
  // points. (JS Array#sort is stable, matching C# OrderBy.)
  const sortedList = [...replacements].sort((r1, r2) => r1.start - r2.start);

  // As we perform replacements, differences between original length and
  // replacement length mean that the start positions for replacements after
  // the first one are affected. This tracks how much the preceding content
  // has lengthened or shortened as we go.
  let offset = 0;
  let text = originalText;

  for (const replacement of sortedList) {
    // Ensure that the replacement is for a valid position in the original
    if (replacement.start > originalText.length) {
      throw new RangeError(
        `Replacment's start position (${replacement.start}) exceeds text length (${originalText.length})`,
      );
    }

    // Ensure that the replacement is replacing the text that it expects to
    // (taking into account any previous replacements that may have been made
    // by this method)
    const at = replacement.start + offset;
    const existingSubstring = text.slice(
      at,
      at + replacement.originalText.length,
    );

    if (existingSubstring !== replacement.originalText) {
      throw new RangeError(
        `Replacement at position ${replacement.start} expected to find text "${replacement.originalText}", but found "${existingSubstring}" instead`,
      );
    }

    // Perform the replacement!
    text =
      text.slice(0, at) +
      replacement.replacementText +
      text.slice(at + replacement.originalText.length);

    // This replacement has probably changed the length of the string leading
    // up to here, so update our offset
    offset +=
      replacement.replacementText.length - replacement.originalText.length;
  }

  return text;
}
