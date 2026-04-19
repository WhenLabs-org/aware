export { computeStackDrift } from "./stack-diff.js";
export { computeContentDrift, diffSections } from "./content-diff.js";
export { computeDriftReport, exitCodeFor } from "./drift-report.js";
export type {
  DriftReport,
  DriftSeverity,
  StackDrift,
  ContentDrift,
  ContentDriftKind,
  SectionDrift,
} from "./types.js";
export type { ComputeDriftOptions } from "./drift-report.js";
