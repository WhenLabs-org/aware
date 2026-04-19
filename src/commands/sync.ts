import * as path from "node:path";
import ora from "ora";
import { detectStack, stackToConfig } from "../detectors/index.js";
import { resolveFragments } from "../fragments/index.js";
import { generateAll } from "../generators/index.js";
import { extractStampedHash } from "../core/hash.js";
import { loadConfig, saveConfig, computeDetectionHash } from "../utils/config.js";
import { readFile, writeFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import type { AwareConfig, DetectedStack, TargetName } from "../types.js";

interface SyncOptions {
  dryRun: boolean;
}

// Root-package key for `_meta.fileHashes` / `_meta.fragmentVersions`.
// Phase 4 will populate per-workspace keys alongside this root entry.
const ROOT_PACKAGE_KEY = "";

export async function syncCommand(options: SyncOptions): Promise<void> {
  const projectRoot = process.cwd();

  const config = await loadConfig(projectRoot);
  if (!config) {
    log.error("No .aware.json found. Run `aware init` first.");
    process.exit(1);
  }

  // Re-detect stack
  const spinner = ora("Detecting current stack...").start();
  const stack: DetectedStack = await detectStack(projectRoot);
  const newStackConfig = stackToConfig(stack);
  const newHash = computeDetectionHash(newStackConfig);
  spinner.stop();

  // Check for stack changes
  if (newHash !== config._meta.lastDetectionHash) {
    log.info("Stack changes detected since last sync:");
    const oldStack = config.stack;
    for (const key of Object.keys(newStackConfig) as (keyof typeof newStackConfig)[]) {
      const oldVal = JSON.stringify(oldStack[key]);
      const newVal = JSON.stringify(newStackConfig[key]);
      if (oldVal !== newVal) {
        log.plain(`  ${key}: ${oldVal} → ${newVal}`);
      }
    }
    log.plain("");

    // Merge new detections into config (preserve user overrides for non-null existing values)
    for (const key of Object.keys(newStackConfig) as (keyof typeof newStackConfig)[]) {
      const current = config.stack[key];
      const detected = newStackConfig[key];
      if (current === null || (Array.isArray(current) && current.length === 0)) {
        (config.stack as unknown as Record<string, unknown>)[key] = detected;
      }
    }
  }

  // Generate
  const fragments = resolveFragments(stack, config);
  const results = generateAll(stack, config, fragments);

  // Write or dry-run
  let changesCount = 0;
  const writtenHashes: Partial<Record<TargetName, string>> = {};
  const writtenVersions: Partial<Record<TargetName, Record<string, string>>> =
    {};

  for (const result of results) {
    const outputPath = path.join(projectRoot, result.filePath);
    const existing = await readFile(outputPath);

    // Record provenance regardless of whether we actually write (so the
    // config reflects the full set of enabled targets after sync).
    const embedded = extractStampedHash(result.content);
    if (embedded) writtenHashes[result.target] = embedded;
    const fragmentVersions: Record<string, string> = {};
    for (const f of fragments) {
      if (f.version !== undefined) fragmentVersions[f.id] = f.version;
    }
    if (Object.keys(fragmentVersions).length > 0) {
      writtenVersions[result.target] = fragmentVersions;
    }

    if (existing === result.content) {
      log.dim(`  ${result.filePath} — no changes`);
      continue;
    }

    changesCount++;
    if (options.dryRun) {
      const oldLines = existing ? existing.split("\n").length : 0;
      const newLines = result.content.split("\n").length;
      log.info(`  ${result.filePath} — would update (${oldLines} → ${newLines} lines)`);
    } else {
      await writeFile(outputPath, result.content);
      log.success(`  ${result.filePath} — updated`);
    }
  }

  if (!options.dryRun) {
    // Update meta
    config._meta.lastSyncedAt = new Date().toISOString();
    config._meta.lastDetectionHash = newHash;
    persistFileHashes(config, writtenHashes);
    persistFragmentVersions(config, writtenVersions);
    await saveConfig(projectRoot, config);
  }

  if (changesCount === 0) {
    log.success("All targets already in sync.");
  } else if (options.dryRun) {
    log.dim(`\nDry run complete. ${changesCount} file(s) would be updated.`);
  } else {
    log.success(`\n${changesCount} file(s) synced.`);
  }
}

function persistFileHashes(
  config: AwareConfig,
  hashes: Partial<Record<TargetName, string>>,
): void {
  if (!config._meta.fileHashes) config._meta.fileHashes = {};
  config._meta.fileHashes[ROOT_PACKAGE_KEY] = {
    ...config._meta.fileHashes[ROOT_PACKAGE_KEY],
    ...hashes,
  };
}

function persistFragmentVersions(
  config: AwareConfig,
  versions: Partial<Record<TargetName, Record<string, string>>>,
): void {
  if (Object.keys(versions).length === 0) return;
  if (!config._meta.fragmentVersions) config._meta.fragmentVersions = {};
  config._meta.fragmentVersions[ROOT_PACKAGE_KEY] = {
    ...config._meta.fragmentVersions[ROOT_PACKAGE_KEY],
    ...versions,
  };
}
