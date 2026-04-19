import { TARGETS } from "../constants.js";
import { detectStack, stackToConfig } from "../detectors/index.js";
import { resolveFragments } from "../fragments/index.js";
import { generateAll } from "../generators/index.js";
import type { AwareConfig, TargetName, TargetsConfig } from "../types.js";
import { computeContentDrift, type DisabledTarget } from "./content-diff.js";
import { computeStackDrift } from "./stack-diff.js";
import type { DriftReport, DriftSeverity } from "./types.js";

/**
 * Root-package key for `_meta.fileHashes` / `_meta.fragmentVersions` and
 * for `ContentDrift.packagePath`. Phase 4 populates per-workspace keys
 * alongside this root entry; single-package projects only ever see this
 * value.
 */
export const ROOT_PACKAGE_KEY = "";

export interface ComputeDriftOptions {
  projectRoot: string;
  config: AwareConfig;
  /** Restrict content-drift analysis to a single target, e.g. for `--target`. */
  target?: TargetName;
  /**
   * Package path relative to the repo root (Phase 4 monorepo use).
   * Defaults to `ROOT_PACKAGE_KEY`. When Phase 4 iterates workspaces it
   * will call `computeDriftReport` once per package with distinct values.
   */
  packagePath?: string;
}

/**
 * Build a full `DriftReport` for the given project. This is the one-stop
 * entry point used by the CLI (`aware diff`, `aware diff --check`),
 * `aware doctor`, and the future TUI.
 */
export async function computeDriftReport(
  opts: ComputeDriftOptions,
): Promise<DriftReport> {
  const { projectRoot, config } = opts;
  const packagePath = opts.packagePath ?? ROOT_PACKAGE_KEY;

  // 1. Detect current stack and diff against saved config.
  const stack = await detectStack(projectRoot);
  const currentStackConfig = stackToConfig(stack);
  const stackDrifts = computeStackDrift(config.stack, currentStackConfig);

  // 2. Regenerate targets with the *saved* config (what sync would write now,
  //    ignoring stack changes the user hasn't yet adopted). Content drift
  //    measures file-vs-sync gap; stack drift measures config-vs-reality gap.
  const fragments = resolveFragments(stack, config);
  const allResults = generateAll(stack, config, fragments);
  const results = opts.target
    ? allResults.filter((r) => r.target === opts.target)
    : allResults;

  // 3. Enumerate disabled targets so `stale` files get surfaced alongside
  //    the enabled-target verdicts. Without this, `doctor` and
  //    `diff --check` disagreed on disabled-but-present files.
  const disabled = collectDisabledTargets(config.targets, opts.target);

  const contentDrifts = await computeContentDrift(projectRoot, results, {
    disabled,
    packagePath,
  });

  const hasStackDrift = stackDrifts.length > 0;
  const hasContentDrift = contentDrifts.length > 0;
  const hasTamper = contentDrifts.some((d) => d.kind === "tampered");

  const severity: DriftSeverity = hasTamper
    ? "tamper"
    : hasStackDrift || hasContentDrift
      ? "warn"
      : "none";

  return {
    stackDrifts,
    contentDrifts,
    severity,
    hasStackDrift,
    hasContentDrift,
    hasTamper,
  };
}

function collectDisabledTargets(
  targets: TargetsConfig,
  onlyTarget: TargetName | undefined,
): DisabledTarget[] {
  const entries = Object.entries(TARGETS) as Array<
    [TargetName, { file: string; name: string }]
  >;
  const result: DisabledTarget[] = [];
  for (const [target, meta] of entries) {
    if (targets[target]) continue;
    if (onlyTarget && target !== onlyTarget) continue;
    result.push({ target, filePath: meta.file });
  }
  return result;
}

/** Exit code for `aware diff --check`. Mirrors DriftSeverity. */
export function exitCodeFor(severity: DriftSeverity): number {
  switch (severity) {
    case "none":
      return 0;
    case "warn":
      return 1;
    case "tamper":
      return 2;
  }
}
