import type {
  AwareConfig,
  DetectedStack,
  Fragment,
  FragmentFunction,
  FragmentModule,
} from "../types.js";

/**
 * Registry of fragment modules. Core fragments self-register at import
 * time via `registerFragmentModule`; plugins (Phase 5) will register
 * through the same API.
 *
 * Phase 0 supports two registration modes:
 *   - Full manifest (`FragmentModule`) — the forward-compatible shape.
 *   - Legacy `FragmentFunction` via `registerLegacyFragment` — each existing
 *     core fragment wraps its bare function so nothing has to change at
 *     once. The wrapper synthesizes a manifest from the runtime Fragment
 *     object the function returns.
 *
 * Resolution rules (Phase 0 minimum):
 *   - All registered modules run in insertion order.
 *   - Results sorted by Fragment.priority (ascending).
 *   - A module with `replaces: [...]` suppresses any result whose id is in
 *     the replaces list. This is the plugin override hook; core fragments
 *     currently don't use it.
 *   - Duplicate `id` without `replaces` is a registration-time error.
 */
export class FragmentRegistry {
  private modules: FragmentModule[] = [];
  private ids = new Set<string>();

  register(module: FragmentModule): void {
    if (this.ids.has(module.id) && !module.replaces?.includes(module.id)) {
      throw new Error(
        `Fragment id collision: "${module.id}" is already registered. ` +
          `Declare \`replaces: ["${module.id}"]\` to override.`,
      );
    }
    this.ids.add(module.id);
    this.modules.push(module);
  }

  registerLegacy(fn: FragmentFunction): void {
    // Legacy fragments carry their id/category/priority inside the returned
    // Fragment object. We adapt by wrapping in a module that delegates to
    // the function at resolve time — the first time it returns non-null
    // we learn the id; before that we use an anonymous synthetic id.
    const synthetic: FragmentModule = {
      id: `__legacy__${this.modules.length}`,
      category: "framework",
      priority: 50,
      build: fn,
    };
    this.modules.push(synthetic);
  }

  resolve(stack: DetectedStack, config: AwareConfig): Fragment[] {
    const replaced = new Set<string>();
    for (const mod of this.modules) {
      for (const id of mod.replaces ?? []) replaced.add(id);
    }

    const results: Fragment[] = [];
    for (const mod of this.modules) {
      const fragment = mod.build(stack, config);
      if (fragment === null) continue;
      if (replaced.has(fragment.id)) continue;
      results.push(fragment);
    }
    results.sort((a, b) => a.priority - b.priority);
    return results;
  }

  /** For tests / debugging. */
  clear(): void {
    this.modules = [];
    this.ids.clear();
  }

  size(): number {
    return this.modules.length;
  }
}

/** Shared default registry. Core fragments populate it; resolvers read from it. */
export const defaultRegistry = new FragmentRegistry();
