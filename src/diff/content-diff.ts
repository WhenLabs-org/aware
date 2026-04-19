import * as path from "node:path";
import { extractStampedHash, verifyStampedHash } from "../core/hash.js";
import { parseSections } from "../core/markers.js";
import { readFile } from "../utils/fs.js";
import type { GeneratorResult } from "../types.js";
import type { ContentDrift, SectionDrift } from "./types.js";

/**
 * Compare on-disk generated files against what the generators would
 * produce right now. Returns one `ContentDrift` entry per drifted target.
 *
 * Verdict hierarchy (per file):
 *   1. File absent on disk (for an enabled target)       -> "missing"
 *   2. File exists, no hash marker                       -> "unmanaged"
 *      (pre-Phase-0 file or hand-written — intentionally not treated
 *       as tampering because the user never opted in to aware's stamp.)
 *   3. File exists, hash present, but doesn't self-verify -> "tampered"
 *   4. File exists, hash self-verifies, content differs   -> "outdated"
 *      from what the generators would produce now
 *   5. Otherwise                                          -> no drift entry
 *
 * Section attribution (only for "outdated"): parse sections in both the
 * on-disk file and the expected content, then diff by section id. If
 * either side has no markers or has structural issues, section attribution
 * is skipped — the file-level verdict still stands.
 */
export async function computeContentDrift(
  projectRoot: string,
  expected: GeneratorResult[],
  packagePath = "",
): Promise<ContentDrift[]> {
  const drifts: ContentDrift[] = [];

  for (const result of expected) {
    const absPath = path.join(projectRoot, result.filePath);
    const onDisk = await readFile(absPath);

    if (onDisk === null) {
      drifts.push({
        target: result.target,
        filePath: result.filePath,
        packagePath,
        kind: "missing",
        message: `${result.filePath} is expected but missing on disk`,
      });
      continue;
    }

    const embeddedHash = extractStampedHash(onDisk);
    if (embeddedHash === null) {
      drifts.push({
        target: result.target,
        filePath: result.filePath,
        packagePath,
        kind: "unmanaged",
        message:
          `${result.filePath} has no aware hash marker. ` +
          `Either it predates Phase 0 or was hand-written; run \`aware sync\` ` +
          `to adopt it (existing content will be replaced).`,
      });
      continue;
    }

    const verification = verifyStampedHash(onDisk);
    if (!verification.matches) {
      drifts.push({
        target: result.target,
        filePath: result.filePath,
        packagePath,
        kind: "tampered",
        message:
          `${result.filePath} was modified outside \`aware sync\`. ` +
          `Move the change into .aware.json (rules / conventions) so it ` +
          `survives the next sync, or run \`aware sync\` to discard it.`,
      });
      continue;
    }

    // Hash self-verifies — the on-disk file is internally consistent.
    // Now check whether regeneration would produce something different.
    if (onDisk === result.content) continue;

    const sections = diffSections(onDisk, result.content);
    drifts.push({
      target: result.target,
      filePath: result.filePath,
      packagePath,
      kind: "outdated",
      sections: sections.length > 0 ? sections : undefined,
      message: sections.length > 0
        ? `${result.filePath} is out of date (${sections.length} section(s) changed)`
        : `${result.filePath} is out of date — run \`aware sync\` to regenerate`,
    });
  }

  return drifts;
}

/**
 * Diff two well-formed generator outputs at the section level. Returns an
 * empty array when either side has no parseable sections — the caller
 * already knows the file is outdated, so we just skip the fine-grained
 * attribution and let the default file-level message carry the verdict.
 */
export function diffSections(onDisk: string, expected: string): SectionDrift[] {
  const onDiskSections = parseSections(onDisk);
  const expectedSections = parseSections(expected);

  if (onDiskSections.length === 0 || expectedSections.length === 0) return [];

  const onDiskMap = new Map(onDiskSections.map((s) => [s.id, s.body]));
  const expectedMap = new Map(expectedSections.map((s) => [s.id, s.body]));

  const drifts: SectionDrift[] = [];
  const allIds = new Set([...onDiskMap.keys(), ...expectedMap.keys()]);

  for (const id of allIds) {
    const was = onDiskMap.get(id);
    const will = expectedMap.get(id);

    if (was === undefined && will !== undefined) {
      drifts.push({ id, kind: "added" });
    } else if (was !== undefined && will === undefined) {
      drifts.push({ id, kind: "removed" });
    } else if (was !== will) {
      drifts.push({ id, kind: "changed" });
    }
  }

  return drifts;
}
