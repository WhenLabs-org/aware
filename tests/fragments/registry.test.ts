import { describe, it, expect } from "vitest";
import { FragmentRegistry } from "../../src/fragments/registry.js";
import type {
  AwareConfig,
  DetectedStack,
  Fragment,
  FragmentModule,
} from "../../src/types.js";

function stub(id: string, priority = 10): FragmentModule {
  return {
    id,
    category: "framework",
    priority,
    build: (): Fragment => ({
      id,
      category: "framework",
      title: id,
      content: `body of ${id}`,
      priority,
    }),
  };
}

function emptyStack(): DetectedStack {
  return {
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
    stateManagement: null,
    cicd: null,
    bundler: null,
  };
}

function emptyConfig(): AwareConfig {
  return {
    version: 2,
    project: { name: "t", description: "", architecture: "" },
    stack: emptyStack() as unknown as AwareConfig["stack"],
    conventions: {},
    rules: [],
    structure: {},
    targets: { claude: true, cursor: false, copilot: false, agents: false },
    _meta: {
      createdAt: "now",
      lastSyncedAt: null,
      lastDetectionHash: "",
      awareVersion: "0.1.0",
    },
  };
}

describe("FragmentRegistry", () => {
  it("resolves fragments sorted by priority", () => {
    const reg = new FragmentRegistry();
    reg.register(stub("b", 20));
    reg.register(stub("a", 10));
    const fragments = reg.resolve(emptyStack(), emptyConfig());
    expect(fragments.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("errors on duplicate id without `replaces`", () => {
    const reg = new FragmentRegistry();
    reg.register(stub("dup"));
    expect(() => reg.register(stub("dup"))).toThrow(/collision/);
  });

  it("allows a module to replace another by id", () => {
    const reg = new FragmentRegistry();
    reg.register(stub("core"));
    const override: FragmentModule = {
      id: "plugin-override",
      category: "framework",
      priority: 5,
      replaces: ["core"],
      build: (): Fragment => ({
        id: "plugin-override",
        category: "framework",
        title: "override",
        content: "overridden",
        priority: 5,
      }),
    };
    reg.register(override);
    const fragments = reg.resolve(emptyStack(), emptyConfig());
    expect(fragments.map((f) => f.id)).toEqual(["plugin-override"]);
  });

  it("skips modules that return null", () => {
    const reg = new FragmentRegistry();
    reg.register({
      id: "opt-in",
      category: "framework",
      priority: 10,
      build: () => null,
    });
    expect(reg.resolve(emptyStack(), emptyConfig())).toEqual([]);
  });

  it("registerLegacy runs bare fragment functions", () => {
    const reg = new FragmentRegistry();
    reg.registerLegacy(
      (): Fragment => ({
        id: "legacy",
        category: "framework",
        title: "legacy",
        content: "hi",
        priority: 10,
      }),
    );
    const fragments = reg.resolve(emptyStack(), emptyConfig());
    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.id).toBe("legacy");
  });
});
