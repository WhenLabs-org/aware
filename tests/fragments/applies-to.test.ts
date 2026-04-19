import { describe, it, expect } from "vitest";
import { FragmentRegistry } from "../../src/fragments/registry.js";
import type {
  AwareConfig,
  DetectedStack,
  Fragment,
  FragmentModule,
} from "../../src/types.js";

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

function withFramework(name: string, version: string | null): DetectedStack {
  return {
    ...emptyStack(),
    framework: {
      name,
      version,
      variant: null,
      confidence: 1,
      detectedFrom: "test",
    },
  };
}

function framework(
  id: string,
  versionRange: string,
  stackName = "nextjs",
): FragmentModule {
  return {
    id,
    category: "framework",
    priority: 10,
    appliesTo: { stack: stackName, versionRange },
    build: (): Fragment => ({
      id: `nextjs-app-router`,
      category: "framework",
      title: id,
      content: `body of ${id}`,
      priority: 10,
    }),
  };
}

describe("FragmentRegistry appliesTo filter", () => {
  it("selects the matching version-range module from several candidates", () => {
    const reg = new FragmentRegistry();
    reg.register(framework("nextjs-13", "13"));
    reg.register(framework("nextjs-14", "14"));
    reg.register(framework("nextjs-15", ">=15"));

    const fragments = reg.resolve(
      withFramework("nextjs", "15.1.2"),
      emptyConfig(),
    );
    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.title).toBe("nextjs-15");
  });

  it("skips modules whose stack name does not match any detected item", () => {
    const reg = new FragmentRegistry();
    reg.register(framework("nextjs-15", ">=15"));
    const fragments = reg.resolve(
      withFramework("remix", "2.0.0"),
      emptyConfig(),
    );
    expect(fragments).toEqual([]);
  });

  it("skips modules with concrete versionRange when detected version is null", () => {
    const reg = new FragmentRegistry();
    reg.register(framework("nextjs-15", ">=15"));
    const fragments = reg.resolve(
      withFramework("nextjs", null),
      emptyConfig(),
    );
    expect(fragments).toEqual([]);
  });

  it("versionRange '*' matches even a null version", () => {
    const reg = new FragmentRegistry();
    reg.register(framework("nextjs-any", "*"));
    const fragments = reg.resolve(
      withFramework("nextjs", null),
      emptyConfig(),
    );
    expect(fragments).toHaveLength(1);
  });

  it("accepts stack: string[] (fragment applies across multiple stack names)", () => {
    const reg = new FragmentRegistry();
    reg.register({
      id: "prisma-any",
      category: "orm",
      priority: 30,
      appliesTo: { stack: ["prisma", "drizzle"] },
      build: (): Fragment => ({
        id: "orm",
        category: "orm",
        title: "multi-orm",
        content: "x",
        priority: 30,
      }),
    });

    const stack: DetectedStack = {
      ...emptyStack(),
      orm: { name: "drizzle", version: "0.34", variant: null, confidence: 1, detectedFrom: "test" },
    };
    const fragments = reg.resolve(stack, emptyConfig());
    expect(fragments).toHaveLength(1);
  });

  it("a module with no appliesTo runs regardless of stack (legacy behavior)", () => {
    const reg = new FragmentRegistry();
    reg.register({
      id: "universal",
      category: "framework",
      priority: 10,
      build: (): Fragment => ({
        id: "universal",
        category: "framework",
        title: "universal",
        content: "x",
        priority: 10,
      }),
    });
    const fragments = reg.resolve(emptyStack(), emptyConfig());
    expect(fragments).toHaveLength(1);
  });
});
