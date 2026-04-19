// ---- Detection types ----

export interface StackItem {
  name: string;
  version: string | null;
  variant: string | null;
  confidence: number;
  detectedFrom: string;
}

export interface DetectedStack {
  framework: StackItem | null;
  language: StackItem | null;
  styling: StackItem | null;
  orm: StackItem | null;
  database: StackItem | null;
  testing: StackItem[];
  linting: StackItem[];
  packageManager: StackItem | null;
  monorepo: StackItem | null;
  deployment: StackItem | null;
  auth: StackItem | null;
  apiStyle: StackItem | null;
  stateManagement: StackItem | null;
  cicd: StackItem | null;
  bundler: StackItem | null;
}

// ---- Config types (.aware.json) ----

export interface AwareConfig {
  version: number;
  project: ProjectMeta;
  stack: StackConfig;
  conventions: ConventionsConfig;
  rules: string[];
  structure: Record<string, string>;
  targets: TargetsConfig;
  _meta: ConfigMeta;
  /** Optional path to another .aware.json whose fields this config inherits (monorepo use). */
  extends?: string;
  /** Optional workspace member globs for monorepo roots. */
  packages?: string[];
}

export interface ProjectMeta {
  name: string;
  description: string;
  architecture: string;
}

export interface StackConfig {
  framework: string | null;
  language: string | null;
  styling: string | null;
  orm: string | null;
  database: string | null;
  testing: string[];
  linting: string[];
  packageManager: string | null;
  monorepo: string | null;
  deployment: string | null;
  auth: string | null;
  apiStyle: string | null;
  stateManagement: string | null;
  cicd: string | null;
  bundler: string | null;
}

export interface ConventionsConfig {
  naming?: NamingConventions;
  imports?: ImportConventions;
  components?: Record<string, string>;
  api?: Record<string, string>;
  testing?: Record<string, string>;
  /**
   * Conventions auto-extracted from scanning project source code.
   * Never overwrites user-authored values in sibling fields.
   */
  extracted?: ExtractedConventions;
  [key: string]:
    | Record<string, string>
    | NamingConventions
    | ImportConventions
    | ExtractedConventions
    | undefined;
}

export interface ExtractedConventions {
  naming?: NamingConventions;
  imports?: ImportConventions;
  tests?: Record<string, string>;
  layout?: Record<string, string>;
  _confidence?: Record<string, number>;
  _sampleSize?: number;
}

export interface NamingConventions {
  files?: string;
  components?: string;
  functions?: string;
  constants?: string;
  database?: string;
}

export interface ImportConventions {
  style?: string;
  order?: string[];
  alias?: string;
}

export interface TargetsConfig {
  claude: boolean;
  cursor: boolean;
  copilot: boolean;
  agents: boolean;
}

export interface ConfigMeta {
  createdAt: string;
  lastSyncedAt: string | null;
  lastDetectionHash: string;
  awareVersion: string;
  /** Hash of each generated file as of last sync, keyed by target. Used to detect hand-edits. */
  fileHashes?: Partial<Record<TargetName, string>>;
  /** Versions of fragments that produced each generated file at last sync. */
  fragmentVersions?: Partial<Record<TargetName, Record<string, string>>>;
}

// ---- Fragment / Generation types ----

export interface Fragment {
  id: string;
  category: FragmentCategory;
  title: string;
  content: string;
  priority: number;
}

export type FragmentCategory =
  | "framework"
  | "language"
  | "styling"
  | "orm"
  | "database"
  | "testing"
  | "linting"
  | "deployment"
  | "auth"
  | "api"
  | "state-management"
  | "cicd";

export type FragmentFunction = (
  stack: DetectedStack,
  config: AwareConfig,
) => Fragment | null;

/**
 * Declarative fragment manifest. Phase 0 introduces this alongside the legacy
 * `FragmentFunction` shape; the registry accepts either form. Later phases
 * migrate fragments to full manifests (version-range resolution, plugin
 * replacement, etc.).
 */
export interface FragmentModule {
  /** Stable identifier used for deduplication, `replaces`, and telemetry. */
  id: string;
  category: FragmentCategory;
  /** Lower = earlier in the rendered output. */
  priority: number;
  /** Stack predicate; reserved for Phase 2 version-aware resolution. */
  appliesTo?: {
    stack?: string;
    versionRange?: string;
  };
  /** Core build function — returns a Fragment or null when not applicable. */
  build: FragmentFunction;
  /** IDs of other fragments this module overrides (plugin override mechanism). */
  replaces?: string[];
  /** Fragment version, used by Phase 1 drift detection for provenance. */
  version?: string;
}

export interface ComposedContext {
  projectSection: string;
  stackSection: string;
  fragmentSections: Fragment[];
  conventionsSection: string;
  rulesSection: string;
  structureSection: string;
}

export type TargetName = "claude" | "cursor" | "copilot" | "agents";

export interface GeneratorResult {
  target: TargetName;
  filePath: string;
  content: string;
  sections: number;
}

// ---- Diff types ----

export interface ProjectDiff {
  addedDeps: string[];
  removedDeps: string[];
  changedFiles: string[];
  stackChanges: StackChange[];
  suggestedUpdates: string[];
}

export interface StackChange {
  category: keyof DetectedStack;
  previous: string | null;
  current: string | null;
  description: string;
}

// ---- Detector interface ----

export interface Detector {
  name: string;
  detect(projectRoot: string): Promise<StackItem | StackItem[] | null>;
}

// ---- Parser types ----

export interface PackageJson {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
  workspaces?: string[] | { packages: string[] };
}
