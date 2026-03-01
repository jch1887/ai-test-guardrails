export type Framework = "playwright" | "cypress";

export type ValidationMode = "advisory" | "warn" | "block";

export type EnforcementAction = "PASSED" | "ADVISED" | "WARNED" | "REJECTED";

export type ViolationSeverity = "critical" | "major" | "minor";

export interface Violation {
  severity: ViolationSeverity;
  rule: string;
  message: string;
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
