import * as path from "node:path";
import { scan, type ScanOptions, type ScanOutput } from "../scan.js";
import { discoverWorkspace, type DiscoveredPackage } from "./discovery.js";

/**
 * Run `scan()` once per workspace package in a monorepo. Each package
 * is treated as its own project root — detectors, extractors, and
 * generators all run scoped to the package directory. The returned
 * `ScanOutput[]` lets callers iterate and generate per-package context
 * files without having to re-implement the orchestration.
 *
 * Non-monorepo projects return a single-element array (the root scan)
 * so callers can branch-lessly iterate.
 */

export interface MonorepoScanResult {
  /** Per-package scan outputs. */
  packages: Array<{
    pkg: DiscoveredPackage;
    result: ScanOutput;
  }>;
  /** The scan of the monorepo root itself (for shared root-level config). */
  root: ScanOutput;
  /** Discovered workspace metadata. */
  workspace: Awaited<ReturnType<typeof discoverWorkspace>>;
}

export async function scanMonorepo(
  projectRoot: string,
  options: Omit<ScanOptions, "projectRoot"> = {},
): Promise<MonorepoScanResult> {
  const workspace = await discoverWorkspace(projectRoot);

  // Always scan the root so the caller can seed root `.aware.json` with
  // shared config (rules, targets). Package configs `extends` this.
  const root = await scan({ ...options, projectRoot });

  if (!workspace.isMonorepo) {
    return { root, packages: [], workspace };
  }

  // Scan packages in parallel, bounded to avoid saturating IO on large
  // monorepos (100+ packages is realistic). Concurrency of 8 is a
  // reasonable default — tighter than unlimited, looser than serial.
  const packageResults = await withBoundedConcurrency(
    workspace.packages,
    8,
    async (pkg) => {
      const result = await scan({ ...options, projectRoot: pkg.absolutePath });
      return { pkg, result };
    },
  );

  return { root, packages: packageResults, workspace };
}

/** Cap the number of in-flight promises. */
async function withBoundedConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) break;
        results[idx] = await worker(items[idx]!);
      }
    });
  await Promise.all(runners);
  return results;
}

/**
 * Compute the `extends` path a package config should use to reach the
 * monorepo root. Returns a POSIX-style relative path because
 * `.aware.json` is meant to be committed to git and must be
 * OS-agnostic.
 */
export function computeExtendsPath(
  monorepoRoot: string,
  packageAbsPath: string,
): string {
  const rel = path.relative(packageAbsPath, monorepoRoot);
  return (rel === "" ? "." : rel).split(path.sep).join("/") + "/.aware.json";
}
