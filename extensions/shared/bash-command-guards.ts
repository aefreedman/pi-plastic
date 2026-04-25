export const WRAPPED_COMMAND_PATTERNS = [
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:["']?[^"'\s]*[\\/])?(?:bash|sh|zsh)(?:\.exe)?\s+-lc\s+(["'])([\s\S]*)\1$/i,
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:["']?[^"'\s]*[\\/])?(?:bash|sh|zsh)(?:\.exe)?\s+-c\s+(["'])([\s\S]*)\1$/i,
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:["']?[^"'\s]*[\\/])?cmd(?:\.exe)?\s+\/[ck]\s+(["'])([\s\S]*)\1$/i,
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:["']?[^"'\s]*[\\/])?(?:pwsh|powershell)(?:\.exe)?\s+-command\s+(["'])([\s\S]*)\1$/i,
];

export function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function stripAssignments(segment: string): string {
  return segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*/, "").trim();
}

export function stripLeadingWrappers(segment: string): string {
  let value = segment.trim();

  while (true) {
    const next = value
      .replace(/^sudo\s+/i, "")
      .replace(/^command\s+/i, "")
      .replace(/^time\s+/i, "")
      .replace(/^nice(?:\s+(?:-n\s+)?-?\d+)?\s+/i, "");

    if (next !== value) {
      value = next.trim();
      continue;
    }

    const envMatch = value.match(/^env\s+([\s\S]*)$/i);
    if (envMatch) {
      let rest = String(envMatch[1] ?? "").trim();
      rest = rest.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*/, "").trim();
      value = rest;
      continue;
    }

    break;
  }

  return value;
}

export function commandMatches(command: string, matcher: (segment: string) => boolean, depth = 0): boolean {
  if (depth > 2) return false;

  const segments = splitSegments(command);
  for (const segment of segments) {
    if (matcher(segment)) return true;

    for (const pattern of WRAPPED_COMMAND_PATTERNS) {
      const match = segment.match(pattern);
      if (!match) continue;
      const wrappedCommand = String(match[2] ?? "").trim();
      if (!wrappedCommand) continue;
      if (commandMatches(wrappedCommand, matcher, depth + 1)) return true;
    }
  }

  return false;
}
