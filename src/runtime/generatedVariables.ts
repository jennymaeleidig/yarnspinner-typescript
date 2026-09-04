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

/** Reserved namespace for generated variables — never authored content. */
export const generatedVariablePrefix = "Yarn.Internal.";

/** Storage key for a piece of content's seen-state (`<<once>>` blocks,
 * line/option `<<once>>` modifiers, and node-group members' `when: once`
 * headers — upstream `$Yarn.Internal.Once.<lineID|nodeTitle>`). */
export const onceVariableKey = (id: string) => `${generatedVariablePrefix}Once:${id}`;

/** Storage key for a piece of content's saliency view count (ticket 47;
 * upstream `$Yarn.Internal.Content.ViewCount.<contentID>`). */
export const contentViewCountVariableKey = (contentId: string) =>
  `${generatedVariablePrefix}Content.ViewCount.${contentId}`;

/** Storage key for a node's visit count (recorded on node return). */
export const visitCountVariableKey = (title: string) =>
  `${generatedVariablePrefix}VisitCount:${title}`;
