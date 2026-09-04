// SPDX-License-Identifier: CC0-1.0
/**
 * One stringify for caught values: an `Error` contributes its message,
 * anything else its `String` form. The catch sites' shared shape, stated
 * once so the message convention cannot drift apart. Internal — not
 * package surface.
 *
 * @internal
 */
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
