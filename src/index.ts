export { createTool } from "./tool.js";
export { scan } from "./scan.js";
export type { ScanOptions, ScanOutput, GeneratedFile } from "./scan.js";
export type {
  DetectedStack,
  StackItem,
  StackConfig,
  AwareConfig,
  ConfigMeta,
  ConventionsConfig,
  ExtractedConventions,
  Fragment,
  FragmentFunction,
  FragmentModule,
  TargetsConfig,
  TargetName,
  GeneratorResult,
} from "./types.js";
export {
  FragmentRegistry,
  defaultRegistry,
  registerFragmentModule,
  resolveFragments,
} from "./fragments/index.js";
export { versionMatches, majorVersion, majorEq } from "./fragments/common.js";
export { migrate } from "./schema/migrate.js";
export {
  hashContent,
  stampHash,
  extractStampedHash,
  verifyStampedHash,
  normalizeForHash,
} from "./core/hash.js";
export { openMarker, closeMarker, wrapSection, parseSections } from "./core/markers.js";
