import * as path from "node:path";
import * as crypto from "node:crypto";
import { readFile, writeFile, fileExists } from "./fs.js";
import { CONFIG_FILE, SCHEMA_VERSION, VERSION } from "../constants.js";
import { migrate } from "../schema/migrate.js";
import type { AwareConfig, StackConfig, TargetsConfig } from "../types.js";

export interface LoadedConfig {
  config: AwareConfig;
  migrated: boolean;
  fromVersion: number;
}

/**
 * Load and (if needed) migrate a `.aware.json` to the current schema.
 * Returns null only when the file is absent or unparseable.
 *
 * Callers that just want the config can use `loadConfig`; callers that need
 * to know whether a migration happened (so they can nudge the user to
 * re-sync) should use `loadConfigWithMeta`.
 */
export async function loadConfigWithMeta(
  projectRoot: string,
): Promise<LoadedConfig | null> {
  const filePath = path.join(projectRoot, CONFIG_FILE);
  const content = await readFile(filePath);
  if (!content) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  try {
    return migrate(raw);
  } catch {
    return null;
  }
}

export async function loadConfig(projectRoot: string): Promise<AwareConfig | null> {
  const loaded = await loadConfigWithMeta(projectRoot);
  return loaded?.config ?? null;
}

export async function saveConfig(projectRoot: string, config: AwareConfig): Promise<void> {
  const filePath = path.join(projectRoot, CONFIG_FILE);
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n");
}

export async function configExists(projectRoot: string): Promise<boolean> {
  return fileExists(path.join(projectRoot, CONFIG_FILE));
}

export function createDefaultConfig(
  projectName: string,
  stack: StackConfig,
  targets: TargetsConfig,
): AwareConfig {
  const hash = computeDetectionHash(stack);

  return {
    version: SCHEMA_VERSION,
    project: {
      name: projectName,
      description: "",
      architecture: "",
    },
    stack,
    conventions: {},
    rules: [],
    structure: {},
    targets,
    _meta: {
      createdAt: new Date().toISOString(),
      lastSyncedAt: null,
      lastDetectionHash: hash,
      awareVersion: VERSION,
      fileHashes: {},
      fragmentVersions: {},
    },
  };
}

export function computeDetectionHash(stack: StackConfig): string {
  return crypto.createHash("md5").update(JSON.stringify(stack)).digest("hex");
}
