import * as crypto from "node:crypto";
import { HASH_MARKER_PREFIX, HASH_PLACEHOLDER } from "../constants.js";

const HASH_COMMENT_RE = /<!--\s*aware:hash:([a-f0-9]+|__AWARE_HASH_PLACEHOLDER__)\s*-->/;

/**
 * Normalize content before hashing so trivial whitespace differences — CRLF
 * vs LF, trailing spaces, blank lines at EOF — don't register as drift.
 */
export function normalizeForHash(content: string): string {
  const lineNormalized = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
  // Always terminate with exactly one newline so stamping and verifying see
  // the same canonical form regardless of whether the file was written with
  // or without a trailing newline.
  return lineNormalized + "\n";
}

/** Hash arbitrary content (normalized) — used by Phase 1 tamper detection. */
export function hashContent(content: string): string {
  const normalized = normalizeForHash(content);
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Compute the hash of a file that contains its own hash slot.
 *
 * Callers assemble the file with `HASH_PLACEHOLDER` where the real hash will
 * live. We hash the placeholder form, then substitute the digest back in.
 * This keeps the hash self-consistent (re-hashing the stamped file with the
 * digest swapped back for the placeholder reproduces the embedded digest)
 * without a chicken-and-egg problem.
 */
export function stampHash(contentWithPlaceholder: string): string {
  if (!contentWithPlaceholder.includes(HASH_PLACEHOLDER)) {
    return contentWithPlaceholder;
  }
  const digest = hashContent(contentWithPlaceholder);
  return contentWithPlaceholder.replace(HASH_PLACEHOLDER, digest);
}

/** Extract the embedded hash from generated-file content, or null if absent. */
export function extractStampedHash(content: string): string | null {
  const match = content.match(HASH_COMMENT_RE);
  if (!match?.[1] || match[1] === HASH_PLACEHOLDER) return null;
  return match[1];
}

/**
 * Recompute what the stamped hash *should* be for the given file content.
 * Used by Phase 1 to detect hand-edits: if the embedded hash doesn't match
 * the expected hash, the file was modified outside `aware sync`.
 */
export function verifyStampedHash(content: string): {
  embedded: string | null;
  expected: string | null;
  matches: boolean;
} {
  const embedded = extractStampedHash(content);
  if (!embedded) return { embedded: null, expected: null, matches: false };

  const withPlaceholder = content.replace(
    HASH_COMMENT_RE,
    `<!-- ${HASH_MARKER_PREFIX}${HASH_PLACEHOLDER} -->`,
  );
  const expected = hashContent(withPlaceholder);
  return { embedded, expected, matches: embedded === expected };
}
