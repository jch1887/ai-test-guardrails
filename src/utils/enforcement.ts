import type {
  ValidationMode,
  EnforcementAction,
  EnforcementPolicy,
  EnforcementThresholds,
  Violation,
} from "../types/guardrail.types.js";

export const DEFAULT_THRESHOLDS: EnforcementThresholds = {
  architectureThreshold: 3,
  flakeRiskThreshold: 0.7,
  determinismThreshold: 0,
};

interface DetectedCounts {
  architectureViolations: number;
  flakeRiskScore: number;
  determinismViolations: number;
}

export function countBySeverity(violations: Violation[]): {
  criticalCount: number;
  majorCount: number;
  minorCount: number;
} {
  return {
    criticalCount: violations.filter((v) => v.severity === "critical").length,
    majorCount: violations.filter((v) => v.severity === "major").length,
    minorCount: violations.filter((v) => v.severity === "minor").length,
  };
}

export function resolveEnforcement(
  mode: ValidationMode,
  detected: DetectedCounts,
  thresholds: EnforcementThresholds,
  allViolations: Violation[] = [],
): EnforcementPolicy {
  const reasons: string[] = [];
  let action: EnforcementAction;

  const { criticalCount, majorCount, minorCount } = countBySeverity(allViolations);

  const hasAnyViolation =
    detected.architectureViolations > 0 ||
    detected.determinismViolations > 0 ||
    detected.flakeRiskScore > 0;

  if (mode === "advisory") {
    action = hasAnyViolation ? "ADVISED" : "PASSED";
  } else if (mode === "warn") {
    const exceedances = getThresholdExceedances(detected, thresholds, reasons);
    action = exceedances > 0 ? "REJECTED" : hasAnyViolation ? "WARNED" : "PASSED";
  } else {
    const archCount = detected.architectureViolations;
    const detCount = detected.determinismViolations;
    const flakeScore = detected.flakeRiskScore;
    if (archCount > 0) {
      reasons.push(
        `${String(archCount)} architecture violation${archCount === 1 ? "" : "s"} (threshold: 0 in block mode)`,
      );
    }
    if (detCount > 0) {
      reasons.push(
        `${String(detCount)} determinism violation${detCount === 1 ? "" : "s"} (threshold: 0 in block mode)`,
      );
    }
    if (flakeScore > 0) {
      reasons.push(
        `flake risk score ${flakeScore.toFixed(2)} exceeds 0 (threshold: 0 in block mode)`,
      );
    }
    action = reasons.length > 0 ? "REJECTED" : "PASSED";
  }

  return {
    mode,
    thresholds,
    detected: {
      ...detected,
      criticalCount,
      majorCount,
      minorCount,
    },
    action,
    reasons,
  };
}

function getThresholdExceedances(
  detected: DetectedCounts,
  thresholds: EnforcementThresholds,
  reasons: string[],
): number {
  let count = 0;

  if (detected.architectureViolations > thresholds.architectureThreshold) {
    count++;
    reasons.push(
      `${String(detected.architectureViolations)} architecture violations exceeded threshold of ${String(thresholds.architectureThreshold)}`,
    );
  }

  if (detected.determinismViolations > thresholds.determinismThreshold) {
    count++;
    reasons.push(
      `${String(detected.determinismViolations)} determinism violations exceeded threshold of ${String(thresholds.determinismThreshold)}`,
    );
  }

  if (detected.flakeRiskScore > thresholds.flakeRiskThreshold) {
    count++;
    reasons.push(
      `flake risk score ${detected.flakeRiskScore.toFixed(2)} exceeded threshold of ${String(thresholds.flakeRiskThreshold)}`,
    );
  }

  return count;
}

export function isValid(action: EnforcementAction): boolean {
  return action === "PASSED" || action === "ADVISED" || action === "WARNED";
}
