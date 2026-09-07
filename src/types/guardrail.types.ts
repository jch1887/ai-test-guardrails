import type ts from "typescript";

export type Framework = "playwright" | "cypress";

export type ValidationMode = "advisory" | "warn" | "block";

export type EnforcementAction = "PASSED" | "ADVISED" | "WARNED" | "REJECTED";

export type ViolationSeverity = "critical" | "major" | "minor";

/** Which validator a rule belongs to. Determines which threshold its violations count against. */
export type RuleCategory = "determinism" | "architecture";

export interface Violation {
  severity: ViolationSeverity;
  rule: string;
  message: string;
  /** A concrete replacement or next step the author can apply to clear the violation. */
  suggestion?: string;
}

export interface EnforcementThresholds {
  architectureThreshold: number;
  flakeRiskThreshold: number;
  determinismThreshold: number;
}

export interface EnforcementPolicy {
  mode: ValidationMode;
  thresholds: EnforcementThresholds;
  detected: {
    architectureViolations: number;
    flakeRiskScore: number;
    determinismViolations: number;
    criticalCount: number;
    majorCount: number;
    minorCount: number;
  };
  action: EnforcementAction;
  reasons: string[];
}

export interface ValidationResult {
  valid: boolean;
  policy: EnforcementPolicy;
  determinismScore: number;
  flakeRiskScore: number;
  architectureScore: number;
  violations: Violation[];
}

export interface DeterminismResult {
  score: number;
  violations: Violation[];
}

export interface FlakeRiskResult {
  score: number;
  factors: FlakeRiskFactor[];
}

export interface FlakeRiskFactor {
  name: string;
  weight: number;
  detected: boolean;
  description: string;
  /** What to change to remove this factor from the score. */
  remediation: string;
}

export interface ArchitectureResult {
  valid: boolean;
  score: number;
  violations: Violation[];
}

export interface ArchitectureToolResult {
  valid: boolean;
  policy: EnforcementPolicy;
  score: number;
  violations: Violation[];
}

export interface FileValidationResult {
  file: string;
  valid: boolean;
  policy: EnforcementPolicy;
  determinismScore: number;
  flakeRiskScore: number;
  architectureScore: number;
  violations: Violation[];
}

export interface ProjectScanSummary {
  scannedAt: string;
  projectPath: string;
  framework: Framework;
  mode: ValidationMode;
  thresholds: EnforcementThresholds;
  totals: {
    files: number;
    passed: number;
    warned: number;
    rejected: number;
    totalViolations: number;
    criticalViolations: number;
    majorViolations: number;
    minorViolations: number;
  };
  scores: {
    averageDeterminism: number;
    averageFlakeRisk: number;
    averageArchitecture: number;
  };
  files: FileValidationResult[];
  topOffenders: FileValidationResult[];
  unsupportedFiles: UnsupportedFileEntry[];
  /** Absolute path of the JSON artefact written for this scan, when `outputPath` was provided. */
  outputPath?: string;
  /** Trend information against the previous recorded scan, when `historyPath` was provided. */
  history?: ScanHistorySummary;
}

export interface UnsupportedFrameworkResult {
  supported: false;
  detectedFramework: string;
  message: string;
  supportedFrameworks: string[];
}

export interface UnsupportedFileEntry {
  file: string;
  detectedFramework: string;
}

// ---------------------------------------------------------------------------
// Custom rule plugins
// ---------------------------------------------------------------------------

/** The AST helper functions exported from `utils/astParser`, handed to custom rules. */
export type RuleHelpers = typeof import("../utils/astParser.js");

export interface RuleContext {
  /** The TypeScript compiler API instance used to parse the file. Use this rather than importing your own copy. */
  ts: typeof ts;
  sourceFile: ts.SourceFile;
  framework: Framework;
  helpers: RuleHelpers;
}

export interface RuleFinding {
  message: string;
  /** 1-based line number. When provided it is prefixed to the message as `[line N]`. */
  line?: number;
  suggestion?: string;
  /** Overrides the rule's default severity for this finding. */
  severity?: ViolationSeverity;
}

export interface CustomRule {
  /** Rule identifier reported in `violations[].rule`, for example `no-console-log`. */
  name: string;
  category: RuleCategory;
  severity: ViolationSeverity;
  description?: string;
  check: (context: RuleContext) => RuleFinding[];
}

export interface GuardrailsPlugin {
  name: string;
  rules: CustomRule[];
}

// ---------------------------------------------------------------------------
// Scan history
// ---------------------------------------------------------------------------

export interface ScanHistoryFileEntry {
  file: string;
  flakeRiskScore: number;
  determinismScore: number;
  architectureScore: number;
  violations: number;
}

export interface ScanHistoryEntry {
  scannedAt: string;
  projectPath: string;
  framework: Framework;
  mode: ValidationMode;
  totals: ProjectScanSummary["totals"];
  scores: ProjectScanSummary["scores"];
  files: ScanHistoryFileEntry[];
}

export interface ScanHistoryFile {
  version: 1;
  entries: ScanHistoryEntry[];
}

export interface FileFlakeTrend {
  file: string;
  previousFlakeRisk: number;
  currentFlakeRisk: number;
  delta: number;
}

export interface ScanHistorySummary {
  historyPath: string;
  entriesRecorded: number;
  previousScannedAt: string | null;
  deltas: {
    averageFlakeRisk: number;
    averageDeterminism: number;
    averageArchitecture: number;
    totalViolations: number;
  } | null;
  regressions: FileFlakeTrend[];
  improvements: FileFlakeTrend[];
}

export interface FlakeHistoryPoint {
  scannedAt: string;
  averageFlakeRisk: number;
  averageDeterminism: number;
  averageArchitecture: number;
  totalViolations: number;
  files: number;
}

export interface FileFlakeHistoryPoint {
  scannedAt: string;
  flakeRiskScore: number;
  determinismScore: number;
  architectureScore: number;
  violations: number;
}

export interface FlakeHistoryReport {
  historyPath: string;
  entries: number;
  series: FlakeHistoryPoint[];
  file?: {
    file: string;
    series: FileFlakeHistoryPoint[];
  };
}
