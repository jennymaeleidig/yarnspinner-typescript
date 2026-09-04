// SPDX-License-Identifier: CC0-1.0
/**
 * Pluggable variable storage (glossary "variable storage").
 *
 * All story state — declared/story variables plus generated variables
 * (once-state, visit counts, saliency history; coding standards §4) — lives
 * in one `VariableStorage`. The runtime ships an in-memory default;
 * injecting a host implementation is the persistence seam: the host mirrors
 * `entries()` to its store (save) and re-injects a pre-populated storage
 * into a fresh `Dialogue` (load). Declare-default seeding skips names the
 * injected storage already holds, so restored values survive construction
 * (upstream's observable contract: its store seeds nothing at construction
 * and falls back to `Program` initial values at read time — a stored value
 * wins, absent names get the declare default; our construction-time seeding
 * is the equivalent contract).
 *
 * Keys are bare variable names (no `$` prefix), matching
 * `Dialogue.getVariable`/`setVariable`; generated keys carry the reserved
 * `Yarn.Internal.` namespace (see generatedVariables.ts) and appear in
 * `entries()` but not in `Dialogue.getVariables()` snapshots.
 */

/** The storage contract the runtime drives (upstream `VariableStorage` role). */
export interface VariableStorage {
  /** Whether the named variable currently has a stored value. */
  has(name: string): boolean;
  /** The named variable's stored value, or `undefined` when absent. */
  get(name: string): unknown;
  /** Store a value (overwrites any previous one). */
  set(name: string, value: unknown): void;
  /** Every stored `[name, value]` pair — generated variables included. */
  entries(): Iterable<[string, unknown]>;
}

/** The in-memory default storage (upstream `InMemoryVariableStorage` role). */
export class InMemoryVariableStorage implements VariableStorage {
  private readonly map = new Map<string, unknown>();

  has(name: string): boolean {
    return this.map.has(name);
  }

  get(name: string): unknown {
    return this.map.get(name);
  }

  set(name: string, value: unknown): void {
    this.map.set(name, value);
  }

  entries(): IterableIterator<[string, unknown]> {
    return this.map.entries();
  }
}
