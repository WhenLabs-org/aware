import * as path from "node:path";
import * as yaml from "js-yaml";
import { readFile } from "../utils/fs.js";

/**
 * Resolved dependency versions from a project's lockfile. Authoritative for
 * "which version is actually installed" — beats `package.json` ranges,
 * which only say "any version that satisfies `^15.0.0`".
 *
 * Phase 2's version-aware fragment resolution relies on this: to pick
 * `nextjs-15` vs `nextjs-14`, we need the exact major that's installed,
 * not the range the author wrote.
 *
 * The reader is best-effort: any parse error yields an empty map, so
 * callers can always fall back to package.json ranges.
 */
export type LockfileVersionMap = Map<string, string>;

/**
 * Read whichever JS lockfile is present in the project. Checks in priority
 * order (pnpm > npm > yarn) — if multiple are present, pnpm wins because
 * it's the most specific in real-world monorepos.
 *
 * Non-JS lockfiles (Cargo.lock, poetry.lock) are intentionally deferred
 * to a later phase when Rust/Python fragments split by version.
 */
export async function readLockfile(projectRoot: string): Promise<LockfileVersionMap> {
  const pnpm = await readPnpmLockfile(projectRoot);
  if (pnpm.size > 0) return pnpm;

  const npm = await readNpmLockfile(projectRoot);
  if (npm.size > 0) return npm;

  const yarn = await readYarnLockfile(projectRoot);
  if (yarn.size > 0) return yarn;

  return new Map();
}

async function readPnpmLockfile(projectRoot: string): Promise<LockfileVersionMap> {
  const content = await readFile(path.join(projectRoot, "pnpm-lock.yaml"));
  if (!content) return new Map();

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch {
    return new Map();
  }
  if (!isObject(parsed)) return new Map();

  const map: LockfileVersionMap = new Map();

  // pnpm v7+: importers.*.dependencies.*.version and .devDependencies.*.version
  // The root package lives at importers["."].
  const importers = parsed.importers;
  if (isObject(importers)) {
    for (const pkgKey of Object.keys(importers)) {
      const importer = importers[pkgKey];
      if (!isObject(importer)) continue;
      for (const field of ["dependencies", "devDependencies"] as const) {
        const deps = importer[field];
        if (!isObject(deps)) continue;
        for (const [name, spec] of Object.entries(deps)) {
          const version = extractPnpmVersion(spec);
          if (version) map.set(name, version);
        }
      }
    }
  }

  // pnpm v5/v6 single-root layout used top-level `dependencies` / `devDependencies`.
  if (map.size === 0) {
    for (const field of ["dependencies", "devDependencies"] as const) {
      const deps = parsed[field];
      if (!isObject(deps)) continue;
      for (const [name, spec] of Object.entries(deps)) {
        const version = extractPnpmVersion(spec);
        if (version) map.set(name, version);
      }
    }
  }

  return map;
}

function extractPnpmVersion(spec: unknown): string | null {
  // Shape-polymorphic: `spec` may be a bare string (older pnpm) or an
  // object `{ specifier, version }` (v7+). pnpm sometimes appends a peer
  // suffix like `1.0.0(peer@2.0.0)` — strip it.
  if (typeof spec === "string") return stripPeerSuffix(spec);
  if (isObject(spec) && typeof spec.version === "string") {
    return stripPeerSuffix(spec.version);
  }
  return null;
}

function stripPeerSuffix(version: string): string {
  const idx = version.indexOf("(");
  return idx === -1 ? version : version.slice(0, idx);
}

async function readNpmLockfile(projectRoot: string): Promise<LockfileVersionMap> {
  const content = await readFile(path.join(projectRoot, "package-lock.json"));
  if (!content) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return new Map();
  }
  if (!isObject(parsed)) return new Map();

  const map: LockfileVersionMap = new Map();

  // npm v3+: packages[path].version, keyed by "node_modules/<name>" or ""
  // (root). We only want direct dependencies — take any package under
  // top-level node_modules, not nested ones, to avoid reporting a
  // transitive version that differs from the direct-dep version.
  const packages = parsed.packages;
  if (isObject(packages)) {
    for (const [key, entry] of Object.entries(packages)) {
      if (!key.startsWith("node_modules/")) continue;
      // Skip nested deps: "node_modules/foo/node_modules/bar" — we only
      // want top-level resolutions.
      if (key.indexOf("/node_modules/", "node_modules/".length) !== -1) continue;
      if (!isObject(entry)) continue;
      const version = entry.version;
      if (typeof version !== "string") continue;
      const name = key.slice("node_modules/".length);
      map.set(name, version);
    }
  }

  // v1/v2 fallback: top-level `dependencies` tree with nested version.
  if (map.size === 0 && isObject(parsed.dependencies)) {
    for (const [name, entry] of Object.entries(parsed.dependencies)) {
      if (isObject(entry) && typeof entry.version === "string") {
        map.set(name, entry.version);
      }
    }
  }

  return map;
}

async function readYarnLockfile(projectRoot: string): Promise<LockfileVersionMap> {
  const content = await readFile(path.join(projectRoot, "yarn.lock"));
  if (!content) return new Map();

  const map: LockfileVersionMap = new Map();

  // yarn.lock is a custom line-based format. Each entry starts with one
  // or more quoted `"name@range":` lines, then indented fields. We pair
  // the first name in the header with the `version` field of its block.
  //
  // Example:
  //   "next@^15.1.0":
  //     version "15.1.2"
  //     resolved "..."
  //
  // Supports both Yarn classic and Berry (same version field location).
  const lines = content.split("\n");
  let currentName: string | null = null;
  for (const line of lines) {
    if (!line.startsWith(" ") && !line.startsWith("\t") && line.trim().length > 0) {
      // Header line. Take the first quoted or unquoted name@range.
      const match = line.match(/^"?([^@"\s,]+(?:@[^@"\s,]+)?)@[^":,]+/);
      if (match?.[1]) {
        currentName = stripScope(match[1]);
      } else {
        currentName = null;
      }
      continue;
    }
    if (currentName && /^\s+version\s/.test(line)) {
      const vm = line.match(/^\s+version\s+"?([^"]+)"?/);
      if (vm?.[1]) {
        // Only write the first version we see per entry.
        if (!map.has(currentName)) map.set(currentName, vm[1]);
      }
    }
  }

  return map;
}

function stripScope(nameAtRange: string): string {
  // `nameAtRange` may be like `@babel/core` or `react` (no range since
  // we matched on `@[^":,]+` already). Regex was greedy — try once more
  // to strip trailing range if present.
  const at = nameAtRange.lastIndexOf("@");
  if (at > 0) {
    // Example: `@babel/core` → idx > 0, but that's the scope marker we
    // want to keep. Distinguish scope (`@foo/bar`) from range (`foo@1.x`).
    const before = nameAtRange.slice(0, at);
    const after = nameAtRange.slice(at + 1);
    if (/^\d/.test(after) || after.startsWith("^") || after.startsWith("~")) {
      return before;
    }
  }
  return nameAtRange;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
