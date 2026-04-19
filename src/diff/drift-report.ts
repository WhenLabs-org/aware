import { detectStack, stackToConfig } from "../detectors/index.js";
import { resolveFragments } from "../fragments/index.js";
import { generateAll } from "../generators/index.js";
import type { AwareConfig, TargetName } from "../types.js";
import { computeContentDrift } from "./content-diff.js";
import { computeStackDrift } from "./stack-diff.js";
import type { DriftReport, DriftSeverity } from "./types.js";

export interface ComputeDriftOptions {
  projectRoot: string;
  config: AwareConfig;
  /** Restrict content-drift analysis to a single target, e.g. for `--target`. */
  target?: TargetName;
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

  const contentDrifts = await computeContentDrift(projectRoot, results);

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
