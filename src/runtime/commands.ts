/**
 * Command parser utilities for Yarn Spinner commands.
 * Commands like <<command_name arg1 arg2>> or <<command_name "arg with spaces">>
 */

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

/**
 * Parse a command string like "command_name arg1 arg2" or "set variable value"
 */
export function parseCommand(content: string): ParsedCommand {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Empty command");
  }

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      // If we have accumulated non-quoted content (e.g. a function name and "(")
      // push it as its own part before entering quoted mode. This prevents the
      // surrounding text from being merged into the quoted content when we
      // later push the quoted value.
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (char === quoteChar && inQuotes) {
      inQuotes = false;
      // Preserve the surrounding quotes in the parsed part so callers that
      // reassemble the expression (e.g. declare handlers) keep string literals
      // intact instead of losing quote characters.
      parts.push(quoteChar + current + quoteChar);
      quoteChar = "";
      current = "";
      continue;
    }

    if (char === " " && !inQuotes) {
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  if (parts.length === 0) {
    throw new Error("No command name found");
  }

  return {
    name: parts[0],
    args: parts.slice(1),
    raw: content,
  };
}
