import * as path from "node:path";
import ora from "ora";
import { computeDriftReport } from "../diff/index.js";
import { loadConfig } from "../utils/config.js";
import { fileExists, readFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { CONFIG_FILE, TARGETS } from "../constants.js";
import type { AwareConfig, TargetsConfig } from "../types.js";

interface DiagnosticResult {
  label: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function doctorCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const results: DiagnosticResult[] = [];

  log.header("aware doctor\n");

  // 1. Check config exists and is valid JSON
  const configPath = path.join(projectRoot, CONFIG_FILE);
  const configContent = await readFile(configPath);

  if (!configContent) {
    log.warn(`${CONFIG_FILE} not found. Run \`aware init\` to generate it.`);
    log.plain("");
    log.plain("  aware init          Generate config and context files");
    log.plain("  aware init --all    Generate for all supported targets");
    log.plain("");
    return;
  }

  // Use loadConfig so migration surfaces. Any migration error aborts before
  // we run the drift engine — stale configs would give misleading output.
  let config: AwareConfig;
  try {
    const loaded = await loadConfig(projectRoot);
    if (!loaded) {
      log.error(`${CONFIG_FILE} contains invalid JSON.`);
      process.exit(1);
    }
    config = loaded;
    results.push({
      label: "Config file",
      status: "ok",
      message: `${CONFIG_FILE} found and parseable`,
    });
  } catch (err) {
    log.error(`${CONFIG_FILE} failed to migrate: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Schema basics
  if (!config.version || !config.project?.name || !config.stack || !config.targets) {
    results.push({
      label: "Config schema",
      status: "error",
      message:
        "Missing required fields (version, project.name, stack, targets)",
    });
  } else {
    results.push({
      label: "Config schema",
      status: "ok",
      message: "All required fields present",
    });
  }

  // 3. Per-target file presence / disabled-but-present
  const targetEntries = Object.entries(TARGETS) as Array<
    [keyof TargetsConfig, { file: string; name: string }]
  >;
  for (const [key, target] of targetEntries) {
    const filePath = path.join(projectRoot, target.file);
    const exists = await fileExists(filePath);
    if (config.targets[key]) {
      results.push(
        exists
          ? {
              label: target.name,
              status: "ok",
              message: `${target.file} exists`,
            }
          : {
              label: target.name,
              status: "warn",
              message: `${target.file} missing — run \`aware sync\``,
            },
      );
    } else if (exists) {
      results.push({
        label: target.name,
        status: "warn",
        message: `${target.file} exists but target is disabled — consider removing it`,
      });
    }
  }

  // 4. Drift engine (stack + content)
  const spinner = ora("Checking drift...").start();
  const report = await computeDriftReport({ projectRoot, config });
  spinner.stop();

  if (report.hasStackDrift) {
    const labels = report.stackDrifts.map((d) => d.key).join(", ");
    results.push({
      label: "Stack drift",
      status: "warn",
      message: `Stack has changed since last sync: ${labels}. Run \`aware sync\``,
    });
  } else {
    results.push({
      label: "Stack drift",
      status: "ok",
      message: "Stack matches last detection",
    });
  }

  for (const drift of report.contentDrifts) {
    results.push({
      label: `${TARGETS[drift.target].name} integrity`,
      status: drift.kind === "tampered" ? "error" : "warn",
      message: drift.message,
    });
  }
  if (report.contentDrifts.length === 0) {
    results.push({
      label: "Generated file integrity",
      status: "ok",
      message: "All generated files verify against their stamped hashes",
    });
  }

  // 5. Check structure paths exist
  if (config.structure) {
    const missingPaths: string[] = [];
    for (const dirPath of Object.keys(config.structure)) {
      const fullPath = path.join(projectRoot, dirPath);
      if (!(await fileExists(fullPath))) {
        missingPaths.push(dirPath);
      }
    }
    if (missingPaths.length > 0) {
      results.push({
        label: "Structure",
        status: "warn",
        message: `${missingPaths.length} configured path(s) missing: ${missingPaths.slice(0, 3).join(", ")}${missingPaths.length > 3 ? "..." : ""}`,
      });
    } else if (Object.keys(config.structure).length > 0) {
      results.push({
        label: "Structure",
        status: "ok",
        message: "All configured paths exist",
      });
    }
  }

  // 6. Empty description / missing rules / freshness
  if (!config.project.description) {
    results.push({
      label: "Description",
      status: "warn",
      message: "project.description is empty — consider adding one",
    });
  }

  if (!config.rules || config.rules.length === 0) {
    results.push({
      label: "Custom rules",
      status: "warn",
      message:
        "No custom rules defined — add project-specific rules to improve context quality",
    });
  } else {
    results.push({
      label: "Custom rules",
      status: "ok",
      message: `${config.rules.length} rule(s) defined`,
    });
  }

  if (config._meta?.lastSyncedAt) {
    const syncDate = new Date(config._meta.lastSyncedAt);
    const daysSinceSync = Math.floor(
      (Date.now() - syncDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceSync > 30) {
      results.push({
        label: "Freshness",
        status: "warn",
        message: `Last synced ${daysSinceSync} days ago — consider running \`aware sync\``,
      });
    } else {
      results.push({
        label: "Freshness",
        status: "ok",
        message: `Last synced ${daysSinceSync} day(s) ago`,
      });
    }
  } else {
    results.push({
      label: "Freshness",
      status: "warn",
      message: "Never synced — run `aware sync` after reviewing config",
    });
  }

  // Print results
  log.plain("");
  let errors = 0;
  let warnings = 0;

  for (const r of results) {
    if (r.status === "ok") {
      log.success(`${r.label}: ${r.message}`);
    } else if (r.status === "warn") {
      log.warn(`${r.label}: ${r.message}`);
      warnings++;
    } else {
      log.error(`${r.label}: ${r.message}`);
      errors++;
    }
  }

  log.plain("");
  if (errors > 0) {
    log.error(`${errors} error(s), ${warnings} warning(s)`);
    process.exit(1);
  } else if (warnings > 0) {
    log.warn(`All checks passed with ${warnings} warning(s)`);
  } else {
    log.success("All checks passed. Project is healthy.");
  }
}
