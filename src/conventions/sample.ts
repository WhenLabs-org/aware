import * as path from "node:path";
import fg from "fast-glob";

/**
 * Pick a representative sample of the project's source files for the
 * convention extractors. Constraints:
 *
 *   - Honor `.gitignore` so we don't scan `node_modules`, `dist`, etc.
 *   - Cap at ~200 total files (across source and test buckets) so
 *     extraction stays fast on large repos.
 *   - Stratify: partition files into `source` (production code) and
 *     `test` (test code) buckets. Naming/layout extractors want source;
 *     the test-layout extractor wants tests.
 *
 * Extraction is heuristic. AST parsing is out of scope — the goal is
 * "pretty sure" signals with explicit confidence, not perfect answers.
 */

export interface SampledFiles {
  /** Source files (production code). Used by naming/layout extractors. */
  source: string[];
  /** Test files. Used by the test-layout extractor. */
  test: string[];
  /** Total file count across both buckets. */
  total: number;
}

// Source-code globs we care about. Keep this tight so the sample is
// representative of what the AI will actually work in.
const SOURCE_GLOBS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.mjs",
  "**/*.cjs",
  "**/*.py",
  "**/*.rs",
  "**/*.go",
  "**/*.vue",
  "**/*.svelte",
];

// Test-file recognition: a file is a test if its path contains one of
// these patterns. Used to partition the sampled files.
const TEST_PATH_PATTERNS = [
  /[./]test[./]/i,
  /[./]tests[./]/i,
  /__tests__[\\/]/,
  /\.test\.[a-z]+$/i,
  /\.spec\.[a-z]+$/i,
  /_test\.[a-z]+$/i,
];

const BASE_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.git/**",
  "**/.husky/**",
  "**/target/**", // Rust
  "**/__pycache__/**",
  "**/*.min.*",
];

export interface SampleOptions {
  /** Max files across source + test buckets. Default 200. */
  limit?: number;
}

export async function sampleProjectFiles(
  projectRoot: string,
  options: SampleOptions = {},
): Promise<SampledFiles> {
  const limit = options.limit ?? 200;

  const all = await fg(SOURCE_GLOBS, {
    cwd: projectRoot,
    dot: false,
    onlyFiles: true,
    ignore: BASE_IGNORE,
    // Note: fast-glob doesn't read .gitignore natively, but our BASE_IGNORE
    // covers the standard build-output cases and callers can extend.
  });

  const source: string[] = [];
  const test: string[] = [];

  for (const relPath of all) {
    const normalized = normalizeSep(relPath);
    if (isTestPath(normalized)) {
      test.push(normalized);
    } else {
      source.push(normalized);
    }
  }

  // Cap each bucket independently so we don't starve the smaller one.
  // Give source 80%, test 20% — naming/layout signals are denser in
  // source; test layout only needs enough files to detect a pattern.
  const sourceCap = Math.floor(limit * 0.8);
  const testCap = limit - sourceCap;

  return {
    source: source.slice(0, sourceCap),
    test: test.slice(0, testCap),
    total: Math.min(source.length, sourceCap) + Math.min(test.length, testCap),
  };
}

export function isTestPath(relPath: string): boolean {
  return TEST_PATH_PATTERNS.some((re) => re.test(relPath));
}

function normalizeSep(p: string): string {
  return p.split(path.sep).join("/");
}
