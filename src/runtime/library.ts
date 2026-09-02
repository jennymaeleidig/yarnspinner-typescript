/**
 * Library-style registry for host functions and command handlers
 * (ticket 43; upstream `Yarn.Library`). Replaces the constructor
 * `functions` map / `handleCommand` split of the fork-era runner.
 *
 * Functions are plain TypeScript callables, so variadic functions are
 * supported naturally; arity/type checking of script-called functions is a
 * compile-time concern (the external-declarations signatures), not a
 * registry concern — mirroring how upstream's `Library` stores delegates
 * and lets the compiler/type checker reason about signatures.
 *
 * Misuse of the registry (duplicate registration, fetching an unknown
 * function) is host programming error and throws — the same treatment as
 * upstream's `ArgumentException`/`InvalidOperationException`, and the same
 * exception made for `EnumTypeBuilder` construction (ADR 0004). Dialogue
 * *content* problems are never thrown; they surface as runtime diagnostics
 * (`logError`/`logDebug`).
 */

/** A host function callable from Yarn expressions and `<<call>>`. */
export type YarnFunction = (...args: unknown[]) => unknown;

/**
 * A host handler invoked when a delivered command carries the registered
 * name. Receives the command's parsed parameters. The `Command` event is
 * still surfaced to the consumer; the handler is a registration point for
 * host side effects (upstream delivers commands to the game's command
 * handler — this registry gives that handler a home next to functions).
 */
export type CommandHandler = (parameters: string[]) => void;

export class Library {
  private functions = new Map<string, YarnFunction>();
  private commandHandlers = new Map<string, CommandHandler>();

  /**
   * Register a function callable from Yarn. Throws on duplicate
   * registration (host programming error, as upstream).
   */
  registerFunction(name: string, fn: YarnFunction): void {
    if (this.functions.has(name)) {
      throw new Error(`A function named "${name}" is already registered in the library`);
    }
    this.functions.set(name, fn);
  }

  deregisterFunction(name: string): void {
    this.functions.delete(name);
  }

  hasFunction(name: string): boolean {
    return this.functions.has(name);
  }

  /** The registered function, or `undefined` when the name is unknown. */
  getFunction(name: string): YarnFunction | undefined {
    return this.functions.get(name);
  }

  /**
   * Register a handler for delivered commands whose name matches
   * `name` (case-insensitively). Throws on duplicate registration.
   */
  registerCommandHandler(name: string, handler: CommandHandler): void {
    const key = name.toLowerCase();
    if (this.commandHandlers.has(key)) {
      throw new Error(`A command handler named "${name}" is already registered in the library`);
    }
    this.commandHandlers.set(key, handler);
  }

  deregisterCommandHandler(name: string): void {
    this.commandHandlers.delete(name.toLowerCase());
  }

  hasCommandHandler(name: string): boolean {
    return this.commandHandlers.has(name.toLowerCase());
  }

  /** The registered handler for a delivered command, or `undefined`. */
  getCommandHandler(name: string): CommandHandler | undefined {
    return this.commandHandlers.get(name.toLowerCase());
  }

  /**
   * Copy all functions and command handlers of `other` into this library.
   * Entries in `other` take precedence (upstream `ImportLibrary`).
   */
  importLibrary(other: Library): void {
    if (!other) return;
    for (const [name, fn] of other.functions) {
      this.functions.set(name, fn);
    }
    for (const [name, handler] of other.commandHandlers) {
      this.commandHandlers.set(name, handler);
    }
  }
}
