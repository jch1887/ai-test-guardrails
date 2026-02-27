export type Framework = "playwright" | "cypress";

export type ValidationMode = "advisory" | "warn" | "block";

export type EnforcementAction = "PASSED" | "ADVISED" | "WARNED" | "REJECTED";

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
  violations: string[];
}

export interface DeterminismResult {
  score: number;
  violations: string[];
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
  violations: string[];
}

export interface ArchitectureToolResult {
  valid: boolean;
  policy: EnforcementPolicy;
  score: number;
  violations: string[];
}

export interface FileValidationResult {
  file: string;
  valid: boolean;
  policy: EnforcementPolicy;
  determinismScore: number;
  flakeRiskScore: number;
  architectureScore: number;
  violations: string[];
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
  };
  scores: {
    averageDeterminism: number;
    averageFlakeRisk: number;
    averageArchitecture: number;
  };
  files: FileValidationResult[];
  topOffenders: FileValidationResult[];
}
