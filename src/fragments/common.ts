import type { StackItem } from "../types.js";

export function matchesStack(item: StackItem | null, name: string): boolean {
  if (!item) return false;
  return item.name.toLowerCase() === name.toLowerCase();
}

export function matchesAny(items: StackItem[], name: string): boolean {
  return items.some(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
}

// ---- Version matching (Phase 0; used in Phase 2 for version-aware fragments) ----

/**
 * Extract the integer major version from a detected item, or null if the
 * version string isn't parseable. Handles leading `^`, `~`, `>=`, etc.
 */
export function majorVersion(item: StackItem | null): number | null {
  if (!item?.version) return null;
  const cleaned = item.version.replace(/^[~^>=<\s]+/, "");
  const first = cleaned.split(".")[0];
  if (!first) return null;
  const parsed = parseInt(first, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function majorEq(item: StackItem | null, major: number): boolean {
  return majorVersion(item) === major;
}

/**
 * Lightweight range predicate. Avoids pulling in semver as a dependency.
 * Supported syntaxes:
 *   - `"*"`           — always matches (including null version)
 *   - `"15"`          — exact major
 *   - `">=15"`, `"<16"`, `">15"`, `"<=16"` — single bound
 *   - `">=14 <16"`    — space-separated bounds (all must hold)
 *   - `"14 || 15"`    — OR, each side evaluated as a sub-range
 *
 * Comparisons are on the major version only; this matches the policy that
 * fragments split only when guidance meaningfully differs across majors.
 */
export function versionMatches(item: StackItem | null, range: string): boolean {
  if (range === "*" || range.trim() === "") return true;
  const major = majorVersion(item);
  if (major === null) return false;

  for (const clause of range.split("||")) {
    if (evaluateClause(major, clause.trim())) return true;
  }
  return false;
}

function evaluateClause(major: number, clause: string): boolean {
  const tokens = clause.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!evaluateToken(major, token)) return false;
  }
  return tokens.length > 0;
}

function evaluateToken(major: number, token: string): boolean {
  const match = token.match(/^(>=|<=|>|<|=)?\s*(\d+)/);
  if (!match) return false;
  const op = match[1] ?? "=";
  const target = parseInt(match[2]!, 10);
  switch (op) {
    case ">=":
      return major >= target;
    case "<=":
      return major <= target;
    case ">":
      return major > target;
    case "<":
      return major < target;
    case "=":
      return major === target;
    default:
      return false;
  }
}
