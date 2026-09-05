// SPDX-License-Identifier: CC0-1.0
/**
 * Generated-variable naming (coding standards §4, CONTEXT.md "Generated
 * variable"): all story state that is not authored content — once-state,
 * visit counts, saliency history — lives in the pluggable variable storage
 * under these reserved keys, so it resets with the storage and never in
 * module globals.
 *
 * The key builders are shared by the runtime (which reads and writes the
 * state) and the program lowering pass (whose `<<once>>` lowering emits
 * `pushVariable`/`popVariable` against the once-state keys), so the bytecode
 * and the runtime reference state by one contract.
 */

import { crc32Hex } from "../compile/crc32.js";

/** Reserved namespace for generated variables — never authored content.
 *
 * Keys mirror upstream's `$Yarn.Internal.*` generated-variable names
 * exactly, leading sigil included (upstream Library.cs
 * `GenerateUniqueContentViewedVariableName`,
 * `GenerateUniqueVisitedVariableForNode`,
 * `ContentSaliencyOption.ViewCountKey`), so host-visible storage
 * inspection matches upstream's shape. The runtime reads generated keys
 * straight from storage — they are never authored variables, so the
 * evaluator's `$`-stripping variable resolution never applies to them. */
export const generatedVariablePrefix = "$Yarn.Internal.";

/** Storage key for a piece of content's seen-state (`<<once>>` blocks,
 * line/option `<<once>>` modifiers, and node-group members' `when: once`
 * headers — upstream `$Yarn.Internal.Once.<lineID>`). */
export const onceVariableKey = (id: string) => `${generatedVariablePrefix}Once.${id}`;

/**
 * The once-state key for a `<<once>>` STATEMENT (upstream
 * `TypeCheckerListener.ExitOnce_primary_clause`): the CRC32 of the
 * statement's location description,
 *
 *     'once' statement in file {sourceFileName}, node {nodeTitle}, line {lineNumber}
 *
 * rendered little-endian lowercase hex (upstream
 * `CRC32.GetChecksumString`), under the once-state namespace —
 * `$Yarn.Internal.Once.<checksum>`. This is the key shape the compile
 * seam's `generateOnceIds` hook should emit statement ids against (the
 * default `${node}#once#${index}` lowering lives in src/compile/compiler.ts).
 */
export function onceStatementVariableKey(ctx: {
  sourceFileName: string;
  nodeTitle: string;
  lineNumber: number;
}): string {
  const description = `'once' statement in file ${ctx.sourceFileName}, node ${ctx.nodeTitle}, line ${ctx.lineNumber}`;
  return onceVariableKey(crc32Hex(description));
}

/** Storage key for a piece of content's saliency view count
 * upstream `$Yarn.Internal.Content.ViewCount.<contentID>`. */
export const contentViewCountVariableKey = (contentId: string) =>
  `${generatedVariablePrefix}Content.ViewCount.${contentId}`;

/** Storage key for a node's visit count (recorded on node return).
 *
 * This runtime's own extension (upstream's nearest analog,
 * `GenerateUniqueVisitedVariableForNode`'s `$Yarn.Internal.Visiting.<node>`,
 * is an unused helper); dot-separated to match the sibling keys. */
export const visitCountVariableKey = (title: string) =>
  `${generatedVariablePrefix}VisitCount.${title}`;
