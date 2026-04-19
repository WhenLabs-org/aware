import { SCHEMA_VERSION } from "../constants.js";
import type { AwareConfig } from "../types.js";
import type { AwareConfigV1 } from "./schema-v1.js";

/**
 * Migrate a parsed `.aware.json` payload of any known version up to the
 * current schema. Unknown shapes fall through as-is — callers that need
 * strictness should validate after migrating.
 *
 * The dispatch walks version-by-version (v1 → v2 → …) so each migrator only
 * needs to handle one step. This keeps future migrations cheap to add.
 */
export function migrate(raw: unknown): {
  config: AwareConfig;
  migrated: boolean;
  fromVersion: number;
} {
  if (!isObject(raw)) {
    throw new Error("Invalid config: expected an object");
  }

  const fromVersion =
    typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : 1;

  let current: unknown = raw;
  let migrated = false;
  let version = fromVersion;

  while (version < SCHEMA_VERSION) {
    if (version === 1) {
      current = migrateV1ToV2(current as AwareConfigV1);
      version = 2;
      migrated = true;
      continue;
    }
    // Unknown intermediate — stop rather than risk corrupting data.
    break;
  }

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Config schema v${version} is newer than this aware CLI supports (v${SCHEMA_VERSION}). Upgrade aware.`,
    );
  }

  return {
    config: current as AwareConfig,
    migrated,
    fromVersion,
  };
}

function migrateV1ToV2(v1: AwareConfigV1): AwareConfig {
  // All v1 fields survive; v2 only adds optional fields. We explicitly
  // initialize `_meta.fileHashes` and `_meta.fragmentVersions` to empty
  // objects so downstream code can assume they exist after a migration.
  const meta = v1._meta ?? {
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
    lastDetectionHash: "",
    awareVersion: "0.0.0",
  };

  return {
    ...(v1 as unknown as AwareConfig),
    version: 2,
    _meta: {
      ...meta,
      fileHashes: {},
      fragmentVersions: {},
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
