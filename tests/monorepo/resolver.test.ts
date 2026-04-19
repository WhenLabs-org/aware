import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolvePackageConfig } from "../../src/monorepo/resolver.js";
import { createDefaultConfig, saveConfig } from "../../src/utils/config.js";
import type { StackConfig, TargetsConfig } from "../../src/types.js";

const emptyStack: StackConfig = {
  framework: null,
  language: null,
  styling: null,
  orm: null,
  database: null,
  testing: [],
  linting: [],
  packageManager: null,
  monorepo: null,
  deployment: null,
  auth: null,
  apiStyle: null,
};
const allTargets: TargetsConfig = {
  claude: true,
  cursor: true,
  copilot: true,
  agents: true,
};

describe("resolvePackageConfig", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "aware-resolver-"));
  });

  it("returns null when no config exists at the leaf", async () => {
    const result = await resolvePackageConfig(tmp);
    expect(result).toBeNull();
  });

  it("returns the leaf config unchanged when it has no extends", async () => {
    const cfg = createDefaultConfig("leaf", emptyStack, allTargets);
    cfg.rules = ["leaf rule"];
    await saveConfig(tmp, cfg);

    const result = await resolvePackageConfig(tmp);
    expect(result).not.toBeNull();
    expect(result!.config.project.name).toBe("leaf");
    expect(result!.config.rules).toEqual(["leaf rule"]);
    expect(result!.chain).toHaveLength(1);
  });

  it("merges root into leaf: leaf wins on overlap, rules concatenate", async () => {
    const rootDir = tmp;
    const pkgDir = path.join(tmp, "apps/web");
    await fs.mkdir(pkgDir, { recursive: true });

    const root = createDefaultConfig("root", emptyStack, allTargets);
    root.rules = ["root rule"];
    root.conventions = { naming: { files: "kebab-case" } };
    await saveConfig(rootDir, root);

    const leaf = createDefaultConfig("@acme/web", emptyStack, allTargets);
    leaf.rules = ["leaf rule"];
    leaf.extends = "../../";
    await saveConfig(pkgDir, leaf);

    const resolved = await resolvePackageConfig(pkgDir);
    expect(resolved).not.toBeNull();
    // leaf.project wins
    expect(resolved!.config.project.name).toBe("@acme/web");
    // rules concatenate (root first, then leaf)
    expect(resolved!.config.rules).toEqual(["root rule", "leaf rule"]);
    // root convention flows through
    expect(resolved!.config.conventions.naming?.files).toBe("kebab-case");
    expect(resolved!.chain.length).toBe(2);
  });

  it("detects a cycle in the extends chain", async () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    await fs.mkdir(a);
    await fs.mkdir(b);

    const cfgA = createDefaultConfig("a", emptyStack, allTargets);
    cfgA.extends = "../b";
    const cfgB = createDefaultConfig("b", emptyStack, allTargets);
    cfgB.extends = "../a";

    await saveConfig(a, cfgA);
    await saveConfig(b, cfgB);

    await expect(resolvePackageConfig(a)).rejects.toThrow(/Cycle/);
  });
});
