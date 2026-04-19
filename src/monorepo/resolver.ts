import * as path from "node:path";
import { loadConfigWithMeta } from "../utils/config.js";
import type { AwareConfig } from "../types.js";

/**
 * Resolve a per-package `.aware.json` into an effective config by
 * following its `extends` chain up to the monorepo root.
 *
 * A package config like:
 *
 *   {
 *     "version": 2,
 *     "extends": "../../.aware.json",
 *     "project": { "name": "@acme/web" },
 *     "stack": { "framework": "nextjs@15:app-router" }
 *   }
 *
 * inherits `rules`, `conventions`, and `targets` from the root, while
 * overriding `project` and `stack` locally. Packages that don't set
 * `extends` are standalone — their config is used as-is.
 *
 * Cycle detection: the chain is bounded at 8 levels (arbitrary but
 * generous), and we also track visited absolute paths so a symlinked
 * loop can't hang the resolver.
 */

const MAX_EXTENDS_DEPTH = 8;

export interface ResolvedPackageConfig {
  /** The effective, fully-merged config. */
  config: AwareConfig;
  /** Directory (absolute) that owned the leaf config. */
  packageRoot: string;
  /**
   * The chain of config files that contributed, in merge order
   * (root → ... → leaf). Kept for debugging and for `doctor` to show
   * "this package inherits from X".
   */
  chain: string[];
}

export async function resolvePackageConfig(
  packageRoot: string,
): Promise<ResolvedPackageConfig | null> {
  const visited = new Set<string>();
  const chain: string[] = [];
  const stack: Array<{ config: AwareConfig; dir: string }> = [];

  let currentDir = packageRoot;
  for (let depth = 0; depth < MAX_EXTENDS_DEPTH; depth++) {
    const absDir = path.resolve(currentDir);
    if (visited.has(absDir)) {
      throw new Error(
        `Cycle in .aware.json \`extends\` chain at ${absDir}. ` +
          `Chain: ${[...chain, absDir].join(" -> ")}`,
      );
    }
    visited.add(absDir);

    const loaded = await loadConfigWithMeta(absDir);
    if (!loaded) break;

    chain.push(path.join(absDir, ".aware.json"));
    stack.push({ config: loaded.config, dir: absDir });

    const ext = loaded.config.extends;
    if (!ext) break;

    // Resolve `extends` relative to the current config's directory.
    // Accept both a directory path (points to the parent config's dir)
    // and a file path (explicit `.aware.json` ref). Directory form is
    // preferred because it matches how tsconfig `extends` works.
    const extResolved = path.resolve(absDir, ext);
    currentDir = (await looksLikeConfigFile(extResolved))
      ? path.dirname(extResolved)
      : extResolved;
  }

  if (stack.length === 0) return null;

  // Merge root → ... → leaf so leaf wins on overlap. `stack` is in
  // leaf-first order (walking up from the package); reverse to
  // root-first so reduce applies parents before children.
  const ordered = [...stack].reverse();
  const [first, ...rest] = ordered;
  const merged = rest.reduce(
    (acc, { config }) => mergeConfigs(acc, config),
    first!.config,
  );

  return {
    config: merged,
    packageRoot: path.resolve(packageRoot),
    chain,
  };
}

async function looksLikeConfigFile(p: string): Promise<boolean> {
  return p.endsWith(".aware.json") || p.endsWith(".json");
}

/**
 * Shallow-merge two AwareConfigs: leaf wins on top-level keys, with
 * object fields (`project`, `stack`, `conventions`, `targets`, `_meta`)
 * shallow-merged one level deep. Rules arrays concatenate (root rules
 * first, then leaf). Structure merges with leaf winning on path
 * collisions.
 */
function mergeConfigs(base: AwareConfig, leaf: AwareConfig): AwareConfig {
  return {
    ...base,
    ...leaf,
    project: { ...base.project, ...leaf.project },
    stack: { ...base.stack, ...leaf.stack },
    conventions: { ...base.conventions, ...leaf.conventions },
    targets: { ...base.targets, ...leaf.targets },
    rules: [...(base.rules ?? []), ...(leaf.rules ?? [])],
    structure: { ...base.structure, ...leaf.structure },
    _meta: { ...base._meta, ...leaf._meta },
  };
}
