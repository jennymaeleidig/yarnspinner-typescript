// SPDX-License-Identifier: CC0-1.0
// Minimal DOM helper shared by the demo tabs. Text goes through
// `textContent` — plain text, no markup rendering.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
