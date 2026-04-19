import type {
  AwareConfig,
  DetectedStack,
  Fragment,
  FragmentFunction,
  FragmentModule,
  StackItem,
} from "../types.js";
import { versionMatches } from "./common.js";

/**
 * Registry of fragment modules. Core fragments self-register at import
 * time via `registerFragmentModule`; plugins (Phase 5) will register
 * through the same API.
 *
 * Phase 0 supports two registration modes:
 *   - Full manifest (`FragmentModule`) — the forward-compatible shape.
 *   - Legacy `FragmentFunction` via `registerLegacy` — each existing
 *     core fragment wraps its bare function so nothing has to change at
 *     once. Duplicate-id protection still applies, but deferred to resolve
 *     time (the id only becomes known when the function runs).
 *
 * Resolution rules:
 *   - All registered modules run in insertion order.
 *   - Results sorted by Fragment.priority (ascending).
 *   - A module with `replaces: [...]` suppresses any result whose id is in
 *     the replaces list. This is the plugin override hook.
 *   - Two fragments that produce the same id without either declaring
 *     `replaces` is a resolve-time error — both in manifest form and
 *     across the legacy bridge.
 *   - `module.version` is threaded onto the returned `Fragment.version`
 *     unless the build function already set one.
 */
export class FragmentRegistry {
  private modules: FragmentModule[] = [];
  private knownManifestIds = new Set<string>();

  register(module: FragmentModule): void {
    const replacesSet = new Set(module.replaces ?? []);
    // Registering a new id is always fine. Registering a colliding id is
    // fine *only* when the new module explicitly declares it's replacing
    // the existing one via `replaces: [conflictingId]`.
    if (this.knownManifestIds.has(module.id) && !replacesSet.has(module.id)) {
      throw new Error(
        `Fragment id collision: "${module.id}" is already registered. ` +
          `Declare \`replaces: ["${module.id}"]\` on the new module to override.`,
      );
    }
    this.knownManifestIds.add(module.id);
    this.modules.push(module);
  }

  registerLegacy(fn: FragmentFunction): void {
    // Legacy fragments carry their id/category/priority inside the
    // returned Fragment object; we can't know them until resolve-time.
    // The synthetic id exists only for internal bookkeeping — callers
    // can't meaningfully target it via `replaces`.
    const synthetic: FragmentModule = {
      id: `__legacy__${this.modules.length}`,
      category: "framework",
      priority: 50,
      build: fn,
    };
    this.modules.push(synthetic);
  }

  resolve(stack: DetectedStack, config: AwareConfig): Fragment[] {
    // Map each replaced id to the winning module. A module declaring
    // `replaces: ["X"]` becomes the sole authority for fragments with
    // id X — its own build function's output is kept; any other module
    // producing the same id is suppressed.
    const replacerFor = new Map<string, FragmentModule>();
    for (const mod of this.modules) {
      for (const id of mod.replaces ?? []) {
        replacerFor.set(id, mod);
      }
    }

    const results: Fragment[] = [];
    const seenIds = new Map<string, FragmentModule>();

    for (const mod of this.modules) {
      // Phase 2: declarative `appliesTo` gate. Fragments that declare
      // `appliesTo.stack` / `appliesTo.versionRange` run only when the
      // detected stack matches. This is what makes
      // nextjs-14 and nextjs-15 coexist in the registry without their
      // ids colliding at resolve time — only one matches per project.
      if (!appliesToMatches(mod, stack)) continue;

      const fragment = mod.build(stack, config);
      if (fragment === null) continue;

      const replacer = replacerFor.get(fragment.id);
      if (replacer && replacer !== mod) continue;

      if (seenIds.has(fragment.id)) {
        const existing = seenIds.get(fragment.id)!;
        throw new Error(
          `Fragment id collision at resolve time: "${fragment.id}" was ` +
            `produced by two fragments (${describeModule(existing)} and ` +
            `${describeModule(mod)}) and neither declares \`replaces\`. ` +
            `Add \`replaces: ["${fragment.id}"]\` to the overriding module.`,
        );
      }
      seenIds.set(fragment.id, mod);

      // Thread module.version onto the Fragment unless the build function
      // already set one explicitly. Phase 1 drift detection needs this.
      const withVersion: Fragment =
        fragment.version === undefined && mod.version !== undefined
          ? { ...fragment, version: mod.version }
          : fragment;

      results.push(withVersion);
    }
    results.sort((a, b) => a.priority - b.priority);
    return results;
  }

  /** For tests / debugging. */
  clear(): void {
    this.modules = [];
    this.knownManifestIds.clear();
  }

  size(): number {
    return this.modules.length;
  }
}

function describeModule(mod: FragmentModule): string {
  if (mod.id.startsWith("__legacy__")) return "a legacy fragment";
  return `module "${mod.id}"`;
}

/**
 * Evaluate a module's `appliesTo` gate against the detected stack.
 * A module without `appliesTo` is always eligible (legacy fragments, or
 * fragments that do their own matching inside `build`).
 *
 * When `appliesTo.stack` is set we look for a stack item with a matching
 * name across all categories (framework, styling, orm, ...). If
 * `appliesTo.versionRange` is also set, that item's version must satisfy
 * the range. This lets three `nextjs` fragments with ranges `"<14"`,
 * `"14"`, and `">=15"` sit in the registry together — only one is ever
 * eligible for a given project.
 */
function appliesToMatches(mod: FragmentModule, stack: DetectedStack): boolean {
  const applies = mod.appliesTo;
  if (!applies) return true;

  const names = applies.stack === undefined
    ? null
    : Array.isArray(applies.stack)
      ? applies.stack
      : [applies.stack];

  if (names !== null) {
    const item = findStackItem(stack, names);
    if (!item) return false;
    if (applies.versionRange && !versionMatches(item, applies.versionRange)) {
      return false;
    }
    return true;
  }

  // `versionRange` alone without `stack` doesn't really make sense —
  // we have no item to compare against. Treat as opt-out (false) so the
  // author notices and sets `stack` too.
  if (applies.versionRange) return false;

  return true;
}

function findStackItem(
  stack: DetectedStack,
  names: readonly string[],
): StackItem | null {
  const lowered = names.map((n) => n.toLowerCase());
  // Defensive on `undefined`: some older test fixtures construct DetectedStack
  // objects without every field populated.
  const candidates: Array<StackItem | StackItem[] | null | undefined> = [
    stack.framework,
    stack.language,
    stack.styling,
    stack.orm,
    stack.database,
    stack.packageManager,
    stack.monorepo,
    stack.deployment,
    stack.auth,
    stack.apiStyle,
    stack.stateManagement,
    stack.cicd,
    stack.bundler,
    ...(stack.testing ?? []),
    ...(stack.linting ?? []),
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) {
      for (const item of c) {
        if (lowered.includes(item.name.toLowerCase())) return item;
      }
    } else if (lowered.includes(c.name.toLowerCase())) {
      return c;
    }
  }
  return null;
}

/** Shared default registry. Core fragments populate it; resolvers read from it. */
export const defaultRegistry = new FragmentRegistry();
